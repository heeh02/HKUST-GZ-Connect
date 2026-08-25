'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('../../credential-store');
const {
  validateCustomProfileProvisioningJournal,
} = require('./custom-profile-provisioning-journal');
const { ensurePrivateDirectoryChain, fsyncPrivateDirectory } = require('../../platform/storage/private-directory');
const { readPrivateFileBounded } = require('../../platform/storage/private-file');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('../../platform/storage/windows-private-file');

const MAX_CUSTOM_PROFILE_PROVISIONING_JOURNAL_BYTES = 256 * 1024;

function binding(value) {
  return JSON.stringify({
    schemaVersion: value.schemaVersion,
    type: value.type,
    identity: value.identity,
    profileDocument: value.profileDocument,
    createdAt: value.createdAt,
    fileReceipts: value.fileReceipts,
    indexTransition: value.indexTransition,
  });
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function serialize(value) {
  const normalized = validateCustomProfileProvisioningJournal(value);
  const data = Buffer.from(`${JSON.stringify(normalized)}\n`, 'utf8');
  if (data.length < 2 || data.length > MAX_CUSTOM_PROFILE_PROVISIONING_JOURNAL_BYTES) {
    data.fill(0);
    throw new TypeError('custom Profile provisioning journal exceeds its storage bound');
  }
  return { normalized, data };
}

class CustomProfileProvisioningJournalStore {
  constructor({
    userData,
    fileSystem = fs,
    platform = process.platform,
    windowsAcl = {
      protect: protectWindowsFileOwnerOnly,
      verify: verifyWindowsFileOwnerOnly,
    },
  } = {}) {
    if (typeof userData !== 'string' || !path.isAbsolute(userData) || path.resolve(userData) !== userData ||
        !fileSystem || typeof fileSystem.openSync !== 'function' ||
        !['darwin', 'linux', 'win32'].includes(platform) ||
        (platform === 'win32' && (typeof windowsAcl?.protect !== 'function' ||
          typeof windowsAcl?.verify !== 'function'))) {
      throw new TypeError('custom Profile provisioning store dependencies are invalid');
    }
    this.userData = userData;
    this.filePath = path.join(userData, 'global', 'custom-profile-provisioning.json');
    this.fileSystem = fileSystem;
    this.platform = platform;
    this.windowsAcl = windowsAcl;
  }

  read() {
    try { this.fileSystem.lstatSync(this.filePath); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (this.platform === 'win32' && !this.windowsAcl.verify(this.filePath)) {
      throw new Error('custom Profile provisioning journal ACL is invalid');
    }
    const { data } = readPrivateFileBounded(this.filePath, {
      maxBytes: MAX_CUSTOM_PROFILE_PROVISIONING_JOURNAL_BYTES,
      minBytes: 2,
      platform: this.platform,
      fileSystem: this.fileSystem,
    });
    try { return validateCustomProfileProvisioningJournal(JSON.parse(data.toString('utf8'))); }
    catch (error) { throw new Error('custom Profile provisioning journal is invalid', { cause: error }); }
    finally { data.fill(0); }
  }

  prepare(value) {
    const { normalized, data } = serialize(value);
    if (normalized.state !== 'prepared') {
      data.fill(0);
      throw new TypeError('custom Profile provisioning journal must start prepared');
    }
    const directory = path.dirname(this.filePath);
    let descriptor = null;
    let created = false;
    try {
      ensurePrivateDirectoryChain(this.userData, directory, {
        fileSystem: this.fileSystem,
        platform: this.platform,
      });
      descriptor = this.fileSystem.openSync(this.filePath, 'wx', 0o600);
      created = true;
      this.fileSystem.writeFileSync(descriptor, data);
      this.fileSystem.fsyncSync?.(descriptor);
      this.fileSystem.closeSync(descriptor);
      descriptor = null;
      if (this.platform === 'win32' &&
          (!this.windowsAcl.protect(this.filePath) || !this.windowsAcl.verify(this.filePath))) {
        throw new Error('custom Profile provisioning journal ACL could not be established');
      }
      const durable = fsyncPrivateDirectory(directory, this.fileSystem, this.platform);
      if (!durable && !sameDocument(this.read(), normalized)) {
        throw new Error('custom Profile provisioning journal prepare is unconfirmed');
      }
      return { prepared: true, durabilityUnconfirmed: !durable };
    } catch (error) {
      if (descriptor !== null) {
        try { this.fileSystem.closeSync(descriptor); } catch {}
      }
      if (created) {
        try { this.fileSystem.unlinkSync(this.filePath); } catch {}
      }
      if (error?.code === 'EEXIST') {
        throw new Error('custom Profile provisioning journal already exists');
      }
      throw new Error('custom Profile provisioning journal prepare failed', { cause: error });
    } finally {
      data.fill(0);
    }
  }

  markMaterialized(value) { return this.#transition(value, 'prepared', 'materialized'); }

  markIndexed(value) { return this.#transition(value, 'materialized', 'indexed'); }

  clearIndexed() {
    const current = this.read();
    if (!current || current.state !== 'indexed') {
      throw new Error('only indexed custom Profile provisioning can be cleared');
    }
    const directory = path.dirname(this.filePath);
    this.fileSystem.unlinkSync(this.filePath);
    if (!fsyncPrivateDirectory(directory, this.fileSystem, this.platform)) {
      throw new Error('custom Profile provisioning journal clear was not durable');
    }
    return true;
  }

  #transition(value, expectedState, nextState) {
    const current = this.read();
    const { normalized, data } = serialize(value);
    try {
      if (!current || current.state !== expectedState || normalized.state !== nextState ||
          binding(current) !== binding(normalized)) {
        throw new Error('custom Profile provisioning transition binding does not match');
      }
      const options = this.platform === 'win32' ? {
        protectTemporary: (file) => this.windowsAcl.protect(file) === true,
        verifyCommitted: (file) => this.windowsAcl.verify(file) === true,
        removeCommittedOnFailure: true,
      } : {};
      const written = atomicWritePrivateFile(this.filePath, data, this.fileSystem, options);
      const observed = this.read();
      if (!sameDocument(observed, normalized)) {
        throw new Error(`custom Profile provisioning ${nextState} is unconfirmed`);
      }
      return { [nextState]: true, durabilityUnconfirmed: !written };
    } finally {
      data.fill(0);
    }
  }
}

module.exports = {
  CustomProfileProvisioningJournalStore,
  MAX_CUSTOM_PROFILE_PROVISIONING_JOURNAL_BYTES,
};
