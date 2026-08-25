'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('../credential-store');
const { ensurePrivateDirectoryChain } = require('../platform/storage/private-directory');
const {
  normalizedIntegrationTargetFile,
} = require('./integration-schema');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('../platform/storage/windows-private-file');

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
    this.tokens = new WeakSet();
  }

  inspect(targetFileValue, payload, { ownedParentRoot = null } = {}) {
    const targetFile = normalizedIntegrationTargetFile(targetFileValue);
    if (!Buffer.isBuffer(payload) || !payload.length || payload.length > MAX_MANAGED_FILE_BYTES) {
      throw new TypeError('managed file payload is invalid');
    }
    const parent = path.dirname(targetFile);
    let parentStat;
    let createParent = false;
    try { parentStat = this.fileSystem.lstatSync(parent); }
    catch (error) {
      if (error?.code !== 'ENOENT' || ownedParentRoot !== parent) {
        throw new ManagedFileError('INTEGRATION_EXPORT_CONFLICT', error);
      }
      const owner = this.fileSystem.lstatSync(path.dirname(parent));
      if (!owner.isDirectory() || owner.isSymbolicLink() ||
          (this.platform !== 'win32' && (owner.mode & 0o077) !== 0)) {
        throw new ManagedFileError('INTEGRATION_EXPORT_CONFLICT');
      }
      createParent = true;
    }
    if (!createParent && (!parentStat.isDirectory() || parentStat.isSymbolicLink())) {
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
        operation: 'replace',
        createParent,
        before: beforeReceipt,
        after: afterReceipt,
        change: sameReceipt(beforeReceipt, afterReceipt)
          ? 'unchanged'
          : (beforeReceipt.present ? 'replace' : 'create'),
      });
    } finally { before?.fill(0); }
  }

  inspectRemoval(targetFileValue, { removeEmptyOwnedParent = null } = {}) {
    const targetFile = normalizedIntegrationTargetFile(targetFileValue);
    const parent = path.dirname(targetFile);
    let parentStat;
    try { parentStat = this.fileSystem.lstatSync(parent); }
    catch (error) { throw new ManagedFileError('INTEGRATION_EXPORT_CONFLICT', error); }
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new ManagedFileError('INTEGRATION_EXPORT_CONFLICT');
    }
    if (removeEmptyOwnedParent !== null && removeEmptyOwnedParent !== parent) {
      throw new ManagedFileError('INTEGRATION_EXPORT_CONFLICT');
    }
    let before = null;
    try {
      before = readRegularFile(targetFile, {
        fileSystem: this.fileSystem, platform: this.platform, missing: true,
      });
      const beforeReceipt = receipt(before);
      return Object.freeze({
        targetFile,
        operation: 'remove',
        createParent: false,
        removeEmptyParent: removeEmptyOwnedParent === parent,
        before: beforeReceipt,
        after: receipt(null),
        change: beforeReceipt.present ? 'remove' : 'unchanged',
      });
    } finally { before?.fill(0); }
  }

  apply(plan, payload, validatePayload = () => true) {
    const token = this.stage(plan, payload, validatePayload);
    try {
      this.finalize(token);
      return Object.freeze({ changed: token.changed, receipt: token.after });
    } catch (error) {
      if (!this.rollback(token)) {
        throw new ManagedFileError('INTEGRATION_ROLLBACK_INCOMPLETE', error);
      }
      throw error;
    }
  }

  stage(plan, payload, validatePayload = () => true) {
    const removal = plan?.operation === 'remove';
    if (!plan || typeof plan !== 'object' || typeof validatePayload !== 'function' ||
        (removal ? payload !== null || plan.after?.present !== false
          : (!Buffer.isBuffer(payload) || !sameReceipt(receipt(payload), plan.after))) ||
        (!removal && plan.operation !== 'replace')) {
      throw new TypeError('managed file apply plan is invalid');
    }
    const targetFile = normalizedIntegrationTargetFile(plan.targetFile);
    let current = null;
    let backup = null;
    let backupPath = null;
    let mutationAttempted = false;
    let createdParent = false;
    try {
      if (plan.createParent === true) {
        try { this.fileSystem.lstatSync(path.dirname(targetFile)); }
        catch (error) {
          if (error?.code !== 'ENOENT') throw new ManagedFileError('INTEGRATION_TARGET_CHANGED', error);
          this.fileSystem.mkdirSync(path.dirname(targetFile), { mode: 0o700 });
          createdParent = true;
        }
        if (!createdParent) throw new ManagedFileError('INTEGRATION_TARGET_CHANGED');
      } else {
        let parent;
        try { parent = this.fileSystem.lstatSync(path.dirname(targetFile)); }
        catch (error) { throw new ManagedFileError('INTEGRATION_TARGET_CHANGED', error); }
        if (!parent.isDirectory() || parent.isSymbolicLink()) {
          throw new ManagedFileError('INTEGRATION_TARGET_CHANGED');
        }
      }
      current = readRegularFile(targetFile, {
        fileSystem: this.fileSystem, platform: this.platform, missing: true,
      });
      if (!sameReceipt(receipt(current), plan.before)) {
        throw new ManagedFileError('INTEGRATION_TARGET_CHANGED');
      }
      if (plan.change === 'unchanged') return this.#token({
        targetFile, before: plan.before, after: plan.after,
        backupPath: null, backupReceipt: null, changed: false, createdParent,
        removeEmptyParent: plan.removeEmptyParent === true,
      });
      if (!removal && validatePayload(payload) !== true) {
        throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
      }
      if (current !== null) {
        backup = Buffer.from(current);
        backupPath = this.#writeBackup(backup);
      }
      mutationAttempted = true;
      if (removal) {
        if (!safeRemove(targetFile, plan.before, this.#dependencies())) {
          throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
        }
      } else if (!this.#writePrivate(targetFile, payload)) {
        throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
      }
      let verified = null;
      try {
        verified = readRegularFile(targetFile, {
          fileSystem: this.fileSystem, platform: this.platform, missing: removal,
        });
        if (!sameReceipt(receipt(verified), plan.after) ||
            (!removal && validatePayload(verified) !== true)) {
          throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
        }
      } finally { verified?.fill(0); }
      return this.#token({
        targetFile, before: plan.before, after: plan.after,
        backupPath, backupReceipt: backup === null ? null : receipt(backup), changed: true,
        createdParent, removeEmptyParent: plan.removeEmptyParent === true,
      });
    } catch (error) {
      if (!mutationAttempted) {
        if (createdParent) this.#removeEmptyParent(path.dirname(targetFile));
        throw error;
      }
      let observed = null;
      try {
        observed = readRegularFile(targetFile, {
          fileSystem: this.fileSystem, platform: this.platform, missing: true,
        });
        if (sameReceipt(receipt(observed), plan.before)) {
          if (backupPath && !safeRemove(backupPath, receipt(backup), this.#dependencies())) {
            throw new ManagedFileError('INTEGRATION_ROLLBACK_INCOMPLETE', error);
          }
          if (createdParent) this.#removeEmptyParent(path.dirname(targetFile));
          throw error;
        }
        if (!sameReceipt(receipt(observed), plan.after)) {
          throw new ManagedFileError('INTEGRATION_ROLLBACK_INCOMPLETE', error);
        }
      } finally { observed?.fill(0); }
      const rolledBack = this.#rollbackWithBuffer(targetFile, plan, backupPath, backup);
      if (!rolledBack) throw new ManagedFileError('INTEGRATION_ROLLBACK_INCOMPLETE', error);
      if (createdParent) this.#removeEmptyParent(path.dirname(targetFile));
      if (error instanceof ManagedFileError) throw error;
      throw new ManagedFileError('INTEGRATION_EXPORT_FAILED', error);
    } finally {
      current?.fill(0);
      backup?.fill(0);
      payload?.fill(0);
    }
  }

  finalize(token) {
    this.#assertToken(token);
    if (token.backupPath &&
        !safeRemove(token.backupPath, token.backupReceipt, this.#dependencies())) {
      throw new ManagedFileError('INTEGRATION_ROLLBACK_INCOMPLETE');
    }
    if (token.removeEmptyParent && token.after.present === false) {
      this.#removeEmptyParent(path.dirname(token.targetFile));
    }
    this.tokens.delete(token);
    return true;
  }

  rollback(token) {
    this.#assertToken(token);
    let backup = null;
    try {
      if (!token.changed) { this.tokens.delete(token); return true; }
      if (token.before.present) {
        if (!token.backupPath) return false;
        backup = readRegularFile(token.backupPath, {
          fileSystem: this.fileSystem, platform: this.platform,
        });
        if (!sameReceipt(receipt(backup), token.backupReceipt) ||
            !sameReceipt(receipt(backup), token.before)) return false;
      }
      const result = this.#rollbackWithBuffer(token.targetFile, token, token.backupPath, backup);
      if (result && token.createdParent) this.#removeEmptyParent(path.dirname(token.targetFile));
      if (result) this.tokens.delete(token);
      return result;
    } catch { return false; }
    finally { backup?.fill(0); }
  }

  #writeBackup(data) {
    ensurePrivateDirectoryChain(this.workspaceRoot, this.backupRoot, {
      fileSystem: this.fileSystem, platform: this.platform,
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let bytes = this.randomBytes(16);
      if (!Buffer.isBuffer(bytes) || bytes.length !== 16) {
        bytes?.fill?.(0);
        throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
      }
      let reference;
      try { reference = `backup-${bytes.toString('hex')}.bin`; }
      finally { bytes.fill(0); bytes = null; }
      const file = path.join(this.backupRoot, reference);
      try { this.fileSystem.lstatSync(file); continue; }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      if (!this.#writePrivate(file, data)) {
        throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
      }
      return file;
    }
    throw new ManagedFileError('INTEGRATION_EXPORT_FAILED');
  }

  #writePrivate(file, data) {
    const options = this.platform === 'win32' ? {
      protectTemporary: (temporary) => this.windowsAcl.protect(temporary) === true,
      verifyCommitted: (committed) => this.windowsAcl.verify(committed) === true,
      removeCommittedOnFailure: true,
    } : {};
    return atomicWritePrivateFile(file, data, this.fileSystem, options);
  }

  #rollbackWithBuffer(targetFile, plan, backupPath, backup) {
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

  #token(value) {
    const token = Object.freeze(value);
    this.tokens.add(token);
    return token;
  }

  #assertToken(token) {
    if (!token || typeof token !== 'object' || !this.tokens.has(token)) {
      throw new TypeError('managed file transaction token is invalid or settled');
    }
  }

  #dependencies() {
    return { fileSystem: this.fileSystem, platform: this.platform };
  }

  #removeEmptyParent(directory) {
    try {
      if (this.fileSystem.readdirSync(directory).length !== 0) return false;
      this.fileSystem.rmdirSync(directory);
      return true;
    } catch { return false; }
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
