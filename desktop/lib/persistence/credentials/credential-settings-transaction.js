'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readPrivateFileBounded } = require('../../platform/storage/private-file');

const TRANSACTION_VERSION = 1;
const MAX_SETTINGS_BYTES = 512 * 1024;
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const MAX_JOURNAL_BYTES = 2 * 1024 * 1024;
let temporarySequence = 0;

function digest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function fsyncDirectory(directory, fileSystem = fs) {
  let descriptor = null;
  try {
    descriptor = fileSystem.openSync(directory, 'r');
    fileSystem.fsyncSync?.(descriptor);
    return true;
  } catch {
    // Directory handles are not available on every Windows filesystem. Files
    // are still fsynced before their atomic rename.
    return process.platform === 'win32';
  } finally {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
  }
}

function durableUnlink(filePath, fileSystem = fs) {
  try {
    fileSystem.unlinkSync(filePath);
    return fsyncDirectory(path.dirname(filePath), fileSystem);
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

function atomicRestore(filePath, data, fileSystem = fs) {
  const directory = path.dirname(filePath);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${temporarySequence++}.restore`,
  );
  let descriptor = null;
  try {
    fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
    descriptor = fileSystem.openSync(temporary, 'wx', 0o600);
    fileSystem.writeFileSync(descriptor, data);
    fileSystem.fsyncSync?.(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    fileSystem.renameSync(temporary, filePath);
    return fsyncDirectory(directory, fileSystem);
  } catch {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
    try { fileSystem.unlinkSync(temporary); } catch {}
    return false;
  }
}

function snapshotFile(filePath, maxBytes, fileSystem = fs) {
  try {
    const { data } = readPrivateFileBounded(filePath, {
      maxBytes,
      minBytes: 0,
      fileSystem,
    });
    return {
      existed: true,
      bytes: data.length,
      sha256: digest(data),
      data: data.toString('base64'),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { existed: false, bytes: 0, sha256: null, data: null };
    }
    throw error;
  }
}

function decodeSnapshot(value, maxBytes) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.existed !== 'boolean') throw new Error('invalid transaction snapshot');
  if (!value.existed) {
    if (value.bytes !== 0 || value.sha256 !== null || value.data !== null) {
      throw new Error('invalid absent transaction snapshot');
    }
    return { existed: false, data: null };
  }
  if (!Number.isInteger(value.bytes) || value.bytes < 0 || value.bytes > maxBytes ||
      typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) ||
      typeof value.data !== 'string') throw new Error('invalid transaction snapshot');
  const data = Buffer.from(value.data, 'base64');
  if (data.length !== value.bytes || digest(data) !== value.sha256 ||
      data.toString('base64') !== value.data) throw new Error('damaged transaction snapshot');
  return { existed: true, data };
}

function transactionPaths(paths) {
  const settings = paths?.settings;
  const settingsBackup = paths?.settingsBackup;
  const credential = paths?.credential;
  if (![settings, settingsBackup, credential].every((value) => (
    typeof value === 'string' && path.isAbsolute(value)
  )) || new Set([settings, settingsBackup, credential]).size !== 3) {
    throw new TypeError('credential transaction paths must be distinct absolute paths');
  }
  return { settings, settingsBackup, credential };
}

function writeJournal(journalPath, document, fileSystem = fs) {
  if (typeof journalPath !== 'string' || !path.isAbsolute(journalPath)) {
    throw new TypeError('credential transaction journal path must be absolute');
  }
  const directory = path.dirname(journalPath);
  let descriptor = null;
  fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    descriptor = fileSystem.openSync(journalPath, 'wx', 0o600);
    fileSystem.writeFileSync(descriptor, JSON.stringify(document));
    fileSystem.fsyncSync?.(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    if (!fsyncDirectory(directory, fileSystem)) {
      throw new Error('could not durably create credential transaction journal');
    }
  } catch (error) {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
    throw error;
  }
}

function beginCredentialSettingsTransaction(journalPath, paths, fileSystem = fs) {
  const target = transactionPaths(paths);
  const document = {
    version: TRANSACTION_VERSION,
    settings: snapshotFile(target.settings, MAX_SETTINGS_BYTES, fileSystem),
    settingsBackup: snapshotFile(target.settingsBackup, MAX_SETTINGS_BYTES, fileSystem),
    credential: snapshotFile(target.credential, MAX_CREDENTIAL_BYTES, fileSystem),
  };
  writeJournal(journalPath, document, fileSystem);
  return true;
}

function readJournal(journalPath, fileSystem = fs) {
  const { data } = readPrivateFileBounded(journalPath, {
    maxBytes: MAX_JOURNAL_BYTES,
    fileSystem,
  });
  try {
    const parsed = JSON.parse(data.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        parsed.version !== TRANSACTION_VERSION) {
      throw new Error('invalid credential transaction journal');
    }
    if (parsed.committed === true && Object.keys(parsed).length === 2) {
      return { committed: true };
    }
    return {
      committed: false,
      settings: decodeSnapshot(parsed.settings, MAX_SETTINGS_BYTES),
      settingsBackup: decodeSnapshot(parsed.settingsBackup, MAX_SETTINGS_BYTES),
      credential: decodeSnapshot(parsed.credential, MAX_CREDENTIAL_BYTES),
    };
  } catch (error) {
    // Parsing, schema, and authenticated snapshot-digest failures prove that
    // the journal is structurally unusable. Transport/permission errors from
    // the bounded descriptor read occur before this block and stay transient.
    error.transactionJournalCorrupt = true;
    throw error;
  }
}

function restoreSnapshot(filePath, snapshot, fileSystem = fs) {
  return snapshot.existed
    ? atomicRestore(filePath, snapshot.data, fileSystem)
    : durableUnlink(filePath, fileSystem);
}

function isolateJournal(journalPath, fileSystem = fs) {
  let sourceStat;
  try {
    sourceStat = fileSystem.lstatSync(journalPath);
  } catch {
    return '';
  }
  // Never rename and chmod an untrusted symlink: chmod follows its target and
  // could change permissions on an unrelated user file. Once the encrypted
  // credential has been cleared, removing the link itself is sufficient.
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() ||
      (process.platform !== 'win32' && sourceStat.nlink !== 1)) {
    durableUnlink(journalPath, fileSystem);
    return '';
  }
  const destination = `${journalPath}.corrupt-${Date.now()}`;
  let descriptor = null;
  try {
    fileSystem.renameSync(journalPath, destination);
    descriptor = fileSystem.openSync(
      destination,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const opened = fileSystem.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== sourceStat.dev || opened.ino !== sourceStat.ino ||
        (process.platform !== 'win32' && opened.nlink !== 1)) {
      throw new Error('credential transaction journal changed during isolation');
    }
    fileSystem.fchmodSync?.(descriptor, 0o600);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    if (!fsyncDirectory(path.dirname(journalPath), fileSystem)) return '';
    return destination;
  } catch {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
    durableUnlink(journalPath, fileSystem);
    durableUnlink(destination, fileSystem);
    return '';
  }
}

function recoverCredentialSettingsTransaction(journalPath, paths, fileSystem = fs) {
  const target = transactionPaths(paths);
  try {
    fileSystem.lstatSync(journalPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, status: 'none' };
    // existsSync collapses EACCES/EIO into false, which would incorrectly
    // authorize a potentially mismatched account/password pair. Any failure
    // other than definite absence is a persistent connection block.
    return { ok: false, status: 'blocked' };
  }
  let snapshots;
  try {
    snapshots = readJournal(journalPath, fileSystem);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      // The journal was proven present immediately above, then disappeared
      // before its no-follow descriptor opened. Treat that as lost rollback
      // proof, not as a retryable read error: a second recovery attempt would
      // otherwise see benign "none" and authorize a mismatched pair.
      return durableUnlink(target.credential, fileSystem)
        ? { ok: false, status: 'credential-cleared' }
        : { ok: false, status: 'blocked' };
    }
    if (!error?.privateFileInvalid && !error?.transactionJournalCorrupt) {
      // A short read, EIO, EACCES, EMFILE, or a journal disappearing between
      // lstat/open is not evidence of corruption. Preserve both the journal
      // and credential and block connection until recovery can retry.
      return { ok: false, status: 'blocked' };
    }
    // Keep the damaged journal as a persistent block marker until the
    // potentially mismatched credential has definitely been removed. This is
    // important on Windows where an antivirus or another process may hold the
    // encrypted file open temporarily.
    if (!durableUnlink(target.credential, fileSystem)) {
      return { ok: false, status: 'blocked' };
    }
    isolateJournal(journalPath, fileSystem);
    return { ok: false, status: 'credential-cleared' };
  }

  if (snapshots.committed) {
    // A durable commit marker proves that both new files reached their commit
    // points. Its eventual deletion is housekeeping, not a reason to roll
    // back the already-consistent pair.
    durableUnlink(journalPath, fileSystem);
    return { ok: true, status: 'committed' };
  }

  const settingsRestored = restoreSnapshot(target.settings, snapshots.settings, fileSystem);
  const backupRestored = restoreSnapshot(
    target.settingsBackup,
    snapshots.settingsBackup,
    fileSystem,
  );
  const credentialRestored = restoreSnapshot(
    target.credential,
    snapshots.credential,
    fileSystem,
  );
  if (!settingsRestored || !backupRestored || !credentialRestored ||
      !durableUnlink(journalPath, fileSystem)) {
    // Never allow automatic login with a credential whose matching settings
    // could not be proven restored. The journal remains for the next retry.
    durableUnlink(target.credential, fileSystem);
    return { ok: false, status: 'blocked' };
  }
  return { ok: true, status: 'recovered' };
}

function commitCredentialSettingsTransaction(journalPath, fileSystem = fs) {
  // Replace rollback data with a small, fsynced commit marker before removing
  // the directory entry. If power fails after this point, startup keeps the
  // new matching pair instead of replaying an obsolete rollback snapshot.
  const marker = Buffer.from(JSON.stringify({
    version: TRANSACTION_VERSION,
    committed: true,
  }));
  if (!atomicRestore(journalPath, marker, fileSystem)) return false;
  durableUnlink(journalPath, fileSystem);
  return true;
}

function recoverAfterBegunFailure(journalPath, paths, fileSystem = fs) {
  const recovery = recoverCredentialSettingsTransaction(journalPath, paths, fileSystem);
  if (recovery.status !== 'none') return recovery;
  // Once begin() returned, absence is no longer the benign "no transaction"
  // state used at startup. A cleaner, AV product, or external process may have
  // removed the only rollback proof after the credential rename but before the
  // settings commit. With no snapshot left, the sole safe outcome is to make
  // automatic login impossible by durably removing the encrypted credential.
  const target = transactionPaths(paths);
  return durableUnlink(target.credential, fileSystem)
    ? { ok: false, status: 'credential-cleared' }
    : { ok: false, status: 'blocked' };
}

function runCredentialSettingsMutation({
  journalPath,
  paths,
  mutate,
  fileSystem = fs,
} = {}) {
  if (typeof mutate !== 'function') throw new TypeError('credential settings mutation is required');
  try {
    beginCredentialSettingsTransaction(journalPath, paths, fileSystem);
  } catch (error) {
    return {
      ok: false,
      phase: 'begin',
      error,
      recovery: recoverCredentialSettingsTransaction(journalPath, paths, fileSystem),
    };
  }

  let value;
  try {
    value = mutate();
    if (value && typeof value.then === 'function') {
      throw new TypeError('credential settings mutation must be synchronous');
    }
  } catch (error) {
    return {
      ok: false,
      phase: 'mutation',
      error,
      recovery: recoverAfterBegunFailure(journalPath, paths, fileSystem),
    };
  }

  if (!commitCredentialSettingsTransaction(journalPath, fileSystem)) {
    const recovery = recoverCredentialSettingsTransaction(journalPath, paths, fileSystem);
    // The marker rename may have reached its commit point even when the
    // following directory fsync reports an error. If recovery reads that
    // authenticated marker, both new files are the authoritative matching
    // pair. Reporting a rollback would make the UI claim the opposite of the
    // actual state (and could prompt a user to repeat a successful logout).
    if (recovery.ok && ['committed', 'none'].includes(recovery.status)) {
      return { ok: true, value, recoveredCommit: true };
    }
    return {
      ok: false,
      phase: 'commit',
      error: new Error('credential transaction commit was not durable'),
      recovery,
    };
  }
  return { ok: true, value };
}

module.exports = {
  MAX_CREDENTIAL_BYTES,
  MAX_JOURNAL_BYTES,
  MAX_SETTINGS_BYTES,
  TRANSACTION_VERSION,
  beginCredentialSettingsTransaction,
  commitCredentialSettingsTransaction,
  recoverCredentialSettingsTransaction,
  recoverAfterBegunFailure,
  runCredentialSettingsMutation,
};
