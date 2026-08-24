'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('./credential-store');
const { readPrivateFileBounded } = require('./private-file');
const { MAX_ENCRYPTED_ENVELOPE_BYTES } = require('./vpn-credential-envelope');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('./windows-private-file');

function normalizedEnvelopePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new TypeError('VPN credential envelope path must be absolute and normalized');
  }
  const normalized = path.resolve(value);
  const root = path.parse(normalized).root;
  if (normalized !== value || normalized === root || path.dirname(normalized) === root) {
    throw new TypeError('VPN credential envelope path must be absolute and normalized');
  }
  return normalized;
}

function fsyncDirectory(directory, fileSystem, platform) {
  let descriptor = null;
  try {
    descriptor = fileSystem.openSync(directory, 'r');
    fileSystem.fsyncSync?.(descriptor);
    return true;
  } catch {
    return platform === 'win32';
  } finally {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
  }
}

class VpnCredentialEnvelopeStore {
  constructor({
    filePath,
    fileSystem = fs,
    platform = process.platform,
    windowsAcl = {
      protect: protectWindowsFileOwnerOnly,
      verify: verifyWindowsFileOwnerOnly,
    },
  } = {}) {
    if (!fileSystem || typeof fileSystem.openSync !== 'function' ||
        !['darwin', 'linux', 'win32'].includes(platform) ||
        (platform === 'win32' &&
          (typeof windowsAcl?.protect !== 'function' || typeof windowsAcl?.verify !== 'function'))) {
      throw new TypeError('VPN credential envelope store dependencies are invalid');
    }
    this.filePath = normalizedEnvelopePath(filePath);
    this.fileSystem = fileSystem;
    this.platform = platform;
    this.windowsAcl = windowsAcl;
  }

  load() {
    try {
      this.fileSystem.lstatSync(this.filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (this.platform === 'win32' && !this.windowsAcl.verify(this.filePath)) {
      throw new Error('invalid private file');
    }
    try {
      return readPrivateFileBounded(this.filePath, {
        maxBytes: MAX_ENCRYPTED_ENVELOPE_BYTES,
        platform: this.platform,
        fileSystem: this.fileSystem,
      }).data;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error('VPN credential envelope disappeared after it was observed', { cause: error });
      }
      throw error;
    }
  }

  save(encrypted) {
    if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 ||
        encrypted.length > MAX_ENCRYPTED_ENVELOPE_BYTES) {
      throw new TypeError('encrypted VPN credential envelope is invalid');
    }
    const options = this.platform === 'win32' ? {
      protectTemporary: (temporary) => this.windowsAcl.protect(temporary) === true,
      verifyCommitted: (committed) => this.windowsAcl.verify(committed) === true,
      removeCommittedOnFailure: true,
    } : {};
    if (!atomicWritePrivateFile(this.filePath, encrypted, this.fileSystem, options)) {
      let observed = null;
      let commitApplied = false;
      try {
        observed = this.load();
        commitApplied = Buffer.isBuffer(observed) && observed.length === encrypted.length &&
          crypto.timingSafeEqual(observed, encrypted);
      } catch {
        commitApplied = false;
      } finally {
        observed?.fill(0);
      }
      const error = new Error('VPN credential envelope save failed');
      error.commitApplied = commitApplied;
      throw error;
    }
    return true;
  }

  remove() {
    const current = this.load();
    if (current === null) return false;
    current.fill(0);
    const directory = path.dirname(this.filePath);
    try {
      this.fileSystem.unlinkSync(this.filePath);
    } catch (error) {
      throw new Error('VPN credential envelope removal failed', { cause: error });
    }
    if (!fsyncDirectory(directory, this.fileSystem, this.platform)) {
      throw new Error('VPN credential envelope removal was not durable');
    }
    return true;
  }
}

module.exports = { VpnCredentialEnvelopeStore };
