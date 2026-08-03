'use strict';

const fs = require('fs');
const { ensureOwnerOnly } = require('./private-file');

function protectedStorageAvailable(safeStorage, platform) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

function savePassword(file, password, safeStorage, platform) {
  if (!password || !protectedStorageAvailable(safeStorage, platform)) return false;
  fs.writeFileSync(file, safeStorage.encryptString(String(password)), { mode: 0o600 });
  ensureOwnerOnly(file);
  return true;
}

function loadPassword(file, safeStorage, platform) {
  try {
    if (!protectedStorageAvailable(safeStorage, platform)) return '';
    return safeStorage.decryptString(fs.readFileSync(file));
  } catch {
    return '';
  }
}

// Status refreshes must not decrypt data: on macOS that may prompt for Keychain
// access. The caller only needs to know whether this app has a private,
// non-empty encrypted password blob. Actual decryption stays in connectOnce.
function hasStoredPassword(filePath, platform = process.platform) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return false;
    // Windows applies ACLs instead of POSIX permission bits. On Unix-like
    // platforms reject a blob readable by group or other users.
    return platform === 'win32' || (stat.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

module.exports = { hasStoredPassword, loadPassword, protectedStorageAvailable, savePassword };
