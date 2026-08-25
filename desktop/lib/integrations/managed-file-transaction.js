'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('../credential-store');
const { ensurePrivateDirectoryChain } = require('../private-directory');
const {
  normalizedIntegrationTargetFile,
} = require('./integration-schema');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('../windows-private-file');

const MAX_MANAGED_FILE_BYTES = 1024 * 1024;

class ManagedFileError extends Error {
  constructor(code, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = 'ManagedFileError';
    this.code = code;
  }
}

function receipt(data) {
  if (data === null) return Object.freeze({ present: false, bytes: 0, sha256: null });
  return Object.freeze({
    present: true,
    bytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
  });
}

function sameReceipt(left, right) {
  return Boolean(left && right && left.present === right.present && left.bytes === right.bytes &&
    left.sha256 === right.sha256);
}

function readRegularFile(file, {
  fileSystem = fs,
  platform = process.platform,
  missing = false,
} = {}) {
  let descriptor = null;
  try {
    let before;
    try { before = fileSystem.lstatSync(file); }
    catch (error) {
      if (missing && error?.code === 'ENOENT') return null;
      throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_MANAGED_FILE_BYTES ||
        (platform !== 'win32' && before.nlink !== 1)) {
      throw new ManagedFileError('INTEGRATION_EXPORT_CONFLICT');
    }
    const constants = fileSystem.constants || fs.constants;
    descriptor = fileSystem.openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = fileSystem.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== before.size || opened.size > MAX_MANAGED_FILE_BYTES ||
        (platform !== 'win32' && opened.nlink !== 1)) {
      throw new ManagedFileError('INTEGRATION_TARGET_CHANGED');
    }
    const data = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < data.length) {
      const count = fileSystem.readSync(descriptor, data, offset, data.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    if (offset !== data.length) {
      data.fill(0);
      throw new ManagedFileError('INTEGRATION_TARGET_CHANGED');
    }
    return data;
  } catch (error) {
    if (error instanceof ManagedFileError) throw error;
    throw new ManagedFileError('INTEGRATION_EXPORT_CONFLICT', error);
  } finally {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
  }
}

function safeRemove(file, expected, dependencies) {
  let data = null;
  try {
    data = readRegularFile(file, { ...dependencies, missing: true });
    if (data === null) return true;
    if (!sameReceipt(receipt(data), expected)) return false;
    dependencies.fileSystem.unlinkSync(file);
    return true;
  } catch { return false; }
  finally { data?.fill(0); }
}

class ManagedFileTransaction {
  constructor({
    workspaceRoot,
    backupRoot,
    fileSystem = fs,
    platform = process.platform,
    randomBytes = crypto.randomBytes,
    windowsAcl = {
      protect: protectWindowsFileOwnerOnly,
      verify: verifyWindowsFileOwnerOnly,
    },
  } = {}) {
    if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot) ||
        path.resolve(workspaceRoot) !== workspaceRoot || workspaceRoot === path.parse(workspaceRoot).root ||
        typeof backupRoot !== 'string' || !path.isAbsolute(backupRoot) ||
        path.resolve(backupRoot) !== backupRoot || typeof randomBytes !== 'function' ||
        !fileSystem || typeof fileSystem.openSync !== 'function' ||
        !['darwin', 'linux', 'win32'].includes(platform) ||
        (platform === 'win32' && (typeof windowsAcl?.protect !== 'function' ||
          typeof windowsAcl?.verify !== 'function'))) {
      throw new TypeError('managed file transaction dependencies are invalid');
    }
    const relative = path.relative(workspaceRoot, backupRoot);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
      throw new TypeError('managed file backup root escapes its workspace');
    }
    Object.assign(this, {
      workspaceRoot, backupRoot, fileSystem, platform, randomBytes, windowsAcl,
    });
  }

  inspect(targetFileValue, payload) {
    const targetFile = normalizedIntegrationTargetFile(targetFileValue);
    if (!Buffer.isBuffer(payload) || !payload.length || payload.length > MAX_MANAGED_FILE_BYTES) {
      throw new TypeError('managed file payload is invalid');
    }
    const parent = path.dirname(targetFile);
    let parentStat;
    try { parentStat = this.fileSystem.lstatSync(parent); }
    catch (error) { throw new ManagedFileError('INTEGRATION_EXPORT_CONFLICT', error); }
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new ManagedFileError('INTEGRATION_EXPORT_CONFLICT');
    }
    let before = null;
    try {
      before = readRegularFile(targetFile, {
        fileSystem: this.fileSystem, platform: this.platform, missing: true,
      });
      const beforeReceipt = receipt(before);
      const afterReceipt = receipt(payload);
      return Object.freeze({
        targetFile,
        before: beforeReceipt,
        after: afterReceipt,
        change: sameReceipt(beforeReceipt, afterReceipt)
          ? 'unchanged'
          : (beforeReceipt.present ? 'replace' : 'create'),
      });
    } finally { before?.fill(0); }
  }

  apply(plan, payload, validatePayload = () => true) {
    if (!plan || typeof plan !== 'object' || typeof validatePayload !== 'function' ||
        !Buffer.isBuffer(payload) || !sameReceipt(receipt(payload), plan.after)) {
      throw new TypeError('managed file apply plan is invalid');
    }
    const targetFile = normalizedIntegrationTargetFile(plan.targetFile);
    let current = null;
    let backup = null;
    let backupPath = null;
    let mutationAttempted = false;
    try {
      current = readRegularFile(targetFile, {
        fileSystem: this.fileSystem, platform: this.platform, missing: true,
      });
      if (!sameReceipt(receipt(current), plan.before)) {
        throw new ManagedFileError('INTEGRATION_TARGET_CHANGED');
      }
      if (plan.change === 'unchanged') return Object.freeze({ changed: false, receipt: plan.after });
      if (validatePayload(payload) !== true) {
        throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
      }
      if (current !== null) {
        backup = Buffer.from(current);
        backupPath = this.#writeBackup(backup);
      }
      mutationAttempted = true;
      if (!this.#writePrivate(targetFile, payload)) {
        throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
      }
      let verified = null;
      try {
        verified = readRegularFile(targetFile, {
          fileSystem: this.fileSystem, platform: this.platform,
        });
        if (!sameReceipt(receipt(verified), plan.after) || validatePayload(verified) !== true) {
          throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
        }
      } finally { verified?.fill(0); }
      if (backupPath && !safeRemove(backupPath, receipt(backup), this.#dependencies())) {
        throw new ManagedFileError('INTEGRATION_ROLLBACK_INCOMPLETE');
      }
      return Object.freeze({ changed: true, receipt: plan.after });
    } catch (error) {
      if (!mutationAttempted) throw error;
      let observed = null;
      try {
        observed = readRegularFile(targetFile, {
          fileSystem: this.fileSystem, platform: this.platform, missing: true,
        });
        if (sameReceipt(receipt(observed), plan.before)) {
          if (backupPath && !safeRemove(backupPath, receipt(backup), this.#dependencies())) {
            throw new ManagedFileError('INTEGRATION_ROLLBACK_INCOMPLETE', error);
          }
          throw error;
        }
        if (!sameReceipt(receipt(observed), plan.after)) {
          throw new ManagedFileError('INTEGRATION_ROLLBACK_INCOMPLETE', error);
        }
      } finally { observed?.fill(0); }
      const rolledBack = this.#rollback(targetFile, plan, backupPath, backup);
      if (!rolledBack) throw new ManagedFileError('INTEGRATION_ROLLBACK_INCOMPLETE', error);
      if (error instanceof ManagedFileError) throw error;
      throw new ManagedFileError('INTEGRATION_EXPORT_FAILED', error);
    } finally {
      current?.fill(0);
      backup?.fill(0);
      payload.fill(0);
    }
  }

  #writeBackup(data) {
    ensurePrivateDirectoryChain(this.workspaceRoot, this.backupRoot, {
      fileSystem: this.fileSystem, platform: this.platform,
    });
    let bytes = this.randomBytes(16);
    if (!Buffer.isBuffer(bytes) || bytes.length !== 16) {
      bytes?.fill?.(0);
      throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
    }
    let reference;
    try { reference = `backup-${bytes.toString('hex')}.bin`; }
    finally { bytes.fill(0); bytes = null; }
    const file = path.join(this.backupRoot, reference);
    if (!this.#writePrivate(file, data)) {
      throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
    }
    return file;
  }

  #writePrivate(file, data) {
    const options = this.platform === 'win32' ? {
      protectTemporary: (temporary) => this.windowsAcl.protect(temporary) === true,
      verifyCommitted: (committed) => this.windowsAcl.verify(committed) === true,
      removeCommittedOnFailure: true,
    } : {};
    return atomicWritePrivateFile(file, data, this.fileSystem, options);
  }

  #rollback(targetFile, plan, backupPath, backup) {
    if (plan.before.present === false) {
      return safeRemove(targetFile, plan.after, this.#dependencies());
    }
    if (!backupPath || !backup || !sameReceipt(receipt(backup), plan.before)) return false;
    if (!safeRemove(targetFile, plan.after, this.#dependencies())) return false;
    if (!this.#writePrivate(targetFile, backup)) return false;
    let restored = null;
    try {
      restored = readRegularFile(targetFile, {
        fileSystem: this.fileSystem, platform: this.platform,
      });
      if (!sameReceipt(receipt(restored), plan.before)) return false;
    } finally { restored?.fill(0); }
    return safeRemove(backupPath, plan.before, this.#dependencies());
  }

  #dependencies() {
    return { fileSystem: this.fileSystem, platform: this.platform };
  }
}

module.exports = {
  MAX_MANAGED_FILE_BYTES,
  ManagedFileError,
  ManagedFileTransaction,
  managedFileReceipt: receipt,
  readManagedRegularFile: readRegularFile,
  sameManagedFileReceipt: sameReceipt,
};
