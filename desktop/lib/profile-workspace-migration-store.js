'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readPrivateFileBounded } = require('./private-file');
const { validateMigrationJournal } = require('./profile-workspace-migration-journal');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('./windows-private-file');

const MAX_MIGRATION_JOURNAL_BYTES = 256 * 1024;
let temporarySequence = 0;

function normalizedJournalPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new TypeError('migration journal path must be an absolute normalized path');
  }
  const normalized = path.resolve(value);
  const root = path.parse(normalized).root;
  if (normalized !== value || normalized === root || path.dirname(normalized) === root) {
    throw new TypeError('migration journal path must be an absolute normalized path');
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

function serializedJournal(document) {
  const normalized = validateMigrationJournal(document);
  const data = Buffer.from(JSON.stringify(normalized), 'utf8');
  if (data.length < 2 || data.length > MAX_MIGRATION_JOURNAL_BYTES) {
    throw new TypeError('migration journal exceeds its storage bound');
  }
  return { normalized, data };
}

function sameBinding(current, next) {
  return current.migrationId === next.migrationId &&
    current.profileId === next.profileId &&
    current.profileRevision === next.profileRevision &&
    current.profileCredentialBindingRevision === next.profileCredentialBindingRevision &&
    current.gatewayOrigin === next.gatewayOrigin &&
    current.protocolFamily === next.protocolFamily &&
    current.sourceSetSha256 === next.sourceSetSha256 &&
    JSON.stringify(current.identity) === JSON.stringify(next.identity);
}

class ProfileWorkspaceMigrationJournalStore {
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
      throw new TypeError('migration journal storage dependencies are invalid');
    }
    this.filePath = normalizedJournalPath(filePath);
    this.fileSystem = fileSystem;
    this.platform = platform;
    this.windowsAcl = windowsAcl;
  }

  read() {
    try {
      this.fileSystem.lstatSync(this.filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (this.platform === 'win32' && !this.windowsAcl.verify(this.filePath)) {
      throw new Error('invalid private file');
    }
    let data;
    try {
      ({ data } = readPrivateFileBounded(this.filePath, {
        maxBytes: MAX_MIGRATION_JOURNAL_BYTES,
        minBytes: 2,
        platform: this.platform,
        fileSystem: this.fileSystem,
      }));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error('migration journal disappeared after it was observed', { cause: error });
      }
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(data.toString('utf8'));
    } catch {
      throw new Error('migration journal is invalid');
    } finally {
      data.fill(0);
    }
    return validateMigrationJournal(parsed);
  }

  prepare(document) {
    const { normalized, data } = serializedJournal(document);
    if (normalized.state !== 'prepared') {
      data.fill(0);
      throw new TypeError('migration journal must be prepared before storage');
    }
    const directory = path.dirname(this.filePath);
    let descriptor = null;
    let created = false;
    try {
      this.fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
      descriptor = this.fileSystem.openSync(this.filePath, 'wx', 0o600);
      created = true;
      this.fileSystem.writeFileSync(descriptor, data);
      this.fileSystem.fsyncSync?.(descriptor);
      this.fileSystem.closeSync(descriptor);
      descriptor = null;
      if (this.platform === 'win32' &&
          (!this.windowsAcl.protect(this.filePath) || !this.windowsAcl.verify(this.filePath))) {
        throw new Error('migration journal Windows ACL is invalid');
      }
      return {
        prepared: true,
        durabilityUnconfirmed: !fsyncDirectory(directory, this.fileSystem, this.platform),
      };
    } catch (error) {
      if (descriptor !== null) {
        try { this.fileSystem.closeSync(descriptor); } catch {}
      }
      if (created) {
        try { this.fileSystem.unlinkSync(this.filePath); } catch {}
        fsyncDirectory(directory, this.fileSystem, this.platform);
      }
      if (error?.code === 'EEXIST') {
        throw new Error('migration journal already exists');
      }
      throw new Error('migration journal prepare failed', { cause: error });
    } finally {
      data.fill(0);
    }
  }

  commit(document) {
    const current = this.read();
    if (!current || current.state !== 'prepared') {
      throw new Error('migration journal is not prepared');
    }
    const { normalized, data } = serializedJournal(document);
    if (normalized.state !== 'committed') {
      data.fill(0);
      throw new TypeError('migration journal commit document is invalid');
    }
    if (!sameBinding(current, normalized)) {
      data.fill(0);
      throw new Error('migration journal binding does not match');
    }

    const directory = path.dirname(this.filePath);
    const temporary = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.${temporarySequence++}.tmp`,
    );
    let descriptor = null;
    let renamed = false;
    try {
      descriptor = this.fileSystem.openSync(temporary, 'wx', 0o600);
      this.fileSystem.writeFileSync(descriptor, data);
      this.fileSystem.fsyncSync?.(descriptor);
      this.fileSystem.closeSync(descriptor);
      descriptor = null;
      if (this.platform === 'win32' &&
          (!this.windowsAcl.protect(temporary) || !this.windowsAcl.verify(temporary))) {
        throw new Error('migration journal temporary Windows ACL is invalid');
      }
      this.fileSystem.renameSync(temporary, this.filePath);
      renamed = true;
      if (this.platform === 'win32' && !this.windowsAcl.verify(this.filePath)) {
        throw new Error('migration journal committed Windows ACL is invalid');
      }
      const durable = fsyncDirectory(directory, this.fileSystem, this.platform);
      if (!durable) {
        const observed = this.read();
        if (!observed || observed.state !== 'committed' || !sameBinding(normalized, observed) ||
            observed.destinationSetSha256 !== normalized.destinationSetSha256) {
          throw new Error('migration journal commit state is unconfirmed');
        }
      }
      return { committed: true, durabilityUnconfirmed: !durable };
    } catch (error) {
      if (descriptor !== null) {
        try { this.fileSystem.closeSync(descriptor); } catch {}
      }
      if (!renamed) {
        try { this.fileSystem.unlinkSync(temporary); } catch {}
      }
      throw new Error('migration journal commit failed', { cause: error });
    } finally {
      data.fill(0);
    }
  }

  clearCommitted() {
    const current = this.read();
    if (current === null) return false;
    if (current.state !== 'committed') {
      throw new Error('prepared migration journal cannot be cleared');
    }
    const directory = path.dirname(this.filePath);
    try {
      this.fileSystem.unlinkSync(this.filePath);
    } catch (error) {
      throw new Error('migration journal clear failed', { cause: error });
    }
    if (!fsyncDirectory(directory, this.fileSystem, this.platform)) {
      throw new Error('migration journal clear was not durable');
    }
    return true;
  }
}

module.exports = {
  MAX_MIGRATION_JOURNAL_BYTES,
  ProfileWorkspaceMigrationJournalStore,
};
