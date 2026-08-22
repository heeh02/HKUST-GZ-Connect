'use strict';

const fs = require('fs');
const path = require('path');
const { readPrivateFileBounded } = require('./private-file');

let temporarySequence = 0;
const MAX_ENCRYPTED_PASSWORD_BYTES = 64 * 1024;

function fsyncDirectory(directory, fileSystem = fs) {
  let descriptor = null;
  try {
    descriptor = fileSystem.openSync(directory, 'r');
    fileSystem.fsyncSync?.(descriptor);
    return true;
  } catch {
    // Directory handles are not available on every Windows filesystem. The
    // encrypted file itself is still fsynced before its atomic rename.
    return process.platform === 'win32';
  } finally {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
  }
}

function protectedStorageAvailable(safeStorage, platform) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

function atomicWritePrivateFile(file, contents, fileSystem = fs, {
  protectTemporary = null,
  verifyCommitted = null,
  removeCommittedOnFailure = false,
} = {}) {
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${temporarySequence++}.tmp`,
  );
  let descriptor = null;
  let committed = false;
  try {
    fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
    descriptor = fileSystem.openSync(temporary, 'wx', 0o600);
    fileSystem.writeFileSync(descriptor, contents);
    if (typeof fileSystem.fsyncSync === 'function') fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    if (protectTemporary && protectTemporary(temporary) !== true) {
      throw new Error('could not protect temporary private file');
    }
    // Same-directory rename is the commit point. Until it succeeds the old
    // encrypted blob is untouched.
    fileSystem.renameSync(temporary, file);
    committed = true;
    if (verifyCommitted && verifyCommitted(file) !== true) {
      throw new Error('could not verify committed private file');
    }
    if (!fsyncDirectory(directory, fileSystem)) {
      throw new Error('could not durably commit encrypted credential');
    }
    return true;
  } catch {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
    try { fileSystem.unlinkSync(temporary); } catch {}
    if (committed && removeCommittedOnFailure) {
      try { fileSystem.unlinkSync(file); } catch {}
    }
    return false;
  }
}

function savePassword(file, password, safeStorage, platform, fileSystem = fs) {
  if (!password) return false;
  try {
    if (!protectedStorageAvailable(safeStorage, platform)) return false;
  } catch {
    return false;
  }
  let encrypted;
  try {
    encrypted = safeStorage.encryptString(String(password));
  } catch {
    return false;
  }
  try {
    const encryptedBytes = Buffer.byteLength(encrypted);
    if (!encrypted || !encryptedBytes || encryptedBytes > MAX_ENCRYPTED_PASSWORD_BYTES) return false;
  } catch {
    return false;
  }
  return atomicWritePrivateFile(file, encrypted, fileSystem);
}

function loadPassword(file, safeStorage, platform) {
  try {
    if (!protectedStorageAvailable(safeStorage, platform)) return '';
    const { data } = readPrivateFileBounded(file, {
      maxBytes: MAX_ENCRYPTED_PASSWORD_BYTES,
      platform,
    });
    return safeStorage.decryptString(data);
  } catch {
    return '';
  }
}

function snapshotPasswordFile(file, fileSystem = fs) {
  try {
    const { data } = readPrivateFileBounded(file, {
      maxBytes: MAX_ENCRYPTED_PASSWORD_BYTES,
      fileSystem,
    });
    return { existed: true, data };
  } catch (error) {
    if (error?.code === 'ENOENT') return { existed: false, data: null };
    return null;
  }
}

function restorePasswordSnapshot(file, snapshot, fileSystem = fs) {
  if (!snapshot || typeof snapshot.existed !== 'boolean') return false;
  if (snapshot.existed) {
    if (!Buffer.isBuffer(snapshot.data) || !snapshot.data.length ||
        snapshot.data.length > MAX_ENCRYPTED_PASSWORD_BYTES) return false;
    return atomicWritePrivateFile(file, snapshot.data, fileSystem);
  }
  try {
    fileSystem.unlinkSync(file);
    return fsyncDirectory(path.dirname(file), fileSystem);
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

function clearPasswordSnapshot(snapshot) {
  if (Buffer.isBuffer(snapshot?.data)) snapshot.data.fill(0);
}

// Status refreshes must not decrypt data: on macOS that may prompt for Keychain
// access. The caller only needs to know whether this app has a private,
// non-empty encrypted password blob. Actual decryption stays in connectOnce.
function hasStoredPassword(filePath, platform = process.platform) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 ||
        stat.size > MAX_ENCRYPTED_PASSWORD_BYTES ||
        (platform !== 'win32' && stat.nlink !== 1)) return false;
    // Windows applies ACLs instead of POSIX permission bits. On Unix-like
    // platforms reject a blob readable by group or other users.
    return platform === 'win32' || (stat.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

module.exports = {
  MAX_ENCRYPTED_PASSWORD_BYTES,
  atomicWritePrivateFile,
  clearPasswordSnapshot,
  hasStoredPassword,
  loadPassword,
  protectedStorageAvailable,
  restorePasswordSnapshot,
  savePassword,
  snapshotPasswordFile,
};
