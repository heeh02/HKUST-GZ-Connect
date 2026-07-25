'use strict';

const fs = require('fs');

function protectedStorageAvailable(safeStorage, platform) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

function savePassword(file, password, safeStorage, platform) {
  if (!password || !protectedStorageAvailable(safeStorage, platform)) return false;
  fs.writeFileSync(file, safeStorage.encryptString(String(password)), { mode: 0o600 });
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

module.exports = { loadPassword, protectedStorageAvailable, savePassword };
