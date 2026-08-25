'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const util = require('node:util');
const { protectedStorageAvailable } = require('../../../credential-store');
const { LEGACY_SOURCE_MAX_BYTES } = require('./legacy-flat-source-receipts');
const { readPrivateFileBounded } = require('../../../platform/storage/private-file');
const {
  LEGACY_SOURCE_IDS,
  legacySourceReceiptDigest,
} = require('./profile-workspace-migration-journal');
const { createLegacyFlatSourcePaths } = require('../../paths/profile-workspace-layout');
const { normalizeSettings } = require('../../../settings-store');
const { parseCredentialField } = require('../../../settings-update');
const { verifyWindowsFileOwnerOnly } = require('../../../platform/storage/windows-private-file');

function sameReceipt(expected, data) {
  return expected.present === true && expected.bytes === data.length &&
    expected.sha256 === crypto.createHash('sha256').update(data).digest('hex');
}

class LegacyMigrationPayloadOwner {
  #payloads;
  #destroyed = false;

  constructor(payloads) {
    this.#payloads = payloads;
    Object.freeze(this);
  }

  withPayloads(callback) {
    if (this.#destroyed) throw new Error('legacy migration payload owner is destroyed');
    if (typeof callback !== 'function') throw new TypeError('legacy migration callback is required');
    const result = callback(Object.freeze({ ...this.#payloads }));
    if (result && typeof result.then === 'function') {
      throw new TypeError('legacy migration payload access must be synchronous');
    }
    return result;
  }

  destroy() {
    if (this.#destroyed) return false;
    this.#destroyed = true;
    for (const payload of Object.values(this.#payloads)) payload?.fill?.(0);
    this.#payloads = {};
    return true;
  }

  toJSON() { return '[redacted legacy migration payloads]'; }
  toString() { return '[redacted legacy migration payloads]'; }
  [util.inspect.custom]() { return '[redacted legacy migration payloads]'; }
}

class LegacyMigrationCredentialOwner {
  #username;
  #password;
  #destroyed = false;

  constructor(username, password) {
    const account = parseCredentialField(username, 'account');
    const secret = parseCredentialField(password, 'password');
    if (!account || account.length > 256 || !secret || secret.length > 4096) {
      throw new TypeError('legacy migration credential is invalid');
    }
    this.#username = Buffer.from(account, 'utf8');
    this.#password = Buffer.from(secret, 'utf8');
    Object.freeze(this);
  }

  withStrings(callback) {
    if (this.#destroyed) throw new Error('legacy migration credential owner is destroyed');
    if (typeof callback !== 'function') throw new TypeError('legacy credential callback is required');
    const result = callback(this.#username.toString('utf8'), this.#password.toString('utf8'));
    if (result && typeof result.then === 'function') {
      throw new TypeError('legacy credential access must be synchronous');
    }
    return result;
  }

  destroy() {
    if (this.#destroyed) return false;
    this.#destroyed = true;
    this.#username.fill(0);
    this.#password.fill(0);
    return true;
  }

  toJSON() { return '[redacted legacy migration credential]'; }
  toString() { return '[redacted legacy migration credential]'; }
  [util.inspect.custom]() { return '[redacted legacy migration credential]'; }
}

function readLegacyMigrationPayloads({
  userData,
  expectedReceipts,
  fileSystem = fs,
  platform = process.platform,
  windowsAcl = { verify: verifyWindowsFileOwnerOnly },
} = {}) {
  if (!fileSystem || typeof fileSystem.openSync !== 'function' ||
      !['darwin', 'linux', 'win32'].includes(platform) ||
      (platform === 'win32' && typeof windowsAcl?.verify !== 'function')) {
    throw new TypeError('legacy migration input dependencies are invalid');
  }
  legacySourceReceiptDigest(expectedReceipts);
  const paths = createLegacyFlatSourcePaths(userData);
  const payloads = {};
  try {
    for (const id of LEGACY_SOURCE_IDS) {
      const expected = expectedReceipts[id];
      if (!expected.present) {
        try {
          fileSystem.lstatSync(paths[id]);
          throw new Error(`unexpected legacy migration source appeared: ${id}`);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        payloads[id] = null;
        continue;
      }
      if (platform === 'win32' && !windowsAcl.verify(paths[id])) {
        throw new Error(`legacy migration source ACL is invalid: ${id}`);
      }
      let data;
      try {
        ({ data } = readPrivateFileBounded(paths[id], {
          maxBytes: LEGACY_SOURCE_MAX_BYTES[id],
          platform,
          fileSystem,
        }));
      } catch (error) {
        throw new Error(`legacy migration source could not be read: ${id}`, { cause: error });
      }
      if (!sameReceipt(expected, data)) {
        data.fill(0);
        throw new Error(`legacy migration source receipt changed: ${id}`);
      }
      payloads[id] = data;
    }
    return new LegacyMigrationPayloadOwner(payloads);
  } catch (error) {
    for (const payload of Object.values(payloads)) payload?.fill?.(0);
    throw error;
  }
}

function openLegacyMigrationCredential({
  settingsBytes,
  encryptedCredential,
  safeStorage,
  platform = process.platform,
} = {}) {
  if (!Buffer.isBuffer(settingsBytes) || settingsBytes.length < 2 ||
      (encryptedCredential !== null && !Buffer.isBuffer(encryptedCredential))) {
    throw new TypeError('legacy migration credential inputs are invalid');
  }
  let parsed;
  try { parsed = JSON.parse(settingsBytes.toString('utf8')); }
  catch (error) { throw new Error('legacy migration settings are invalid', { cause: error }); }
  const settings = normalizeSettings(parsed);
  if (encryptedCredential === null) {
    if (settings.username) throw new Error('legacy migration credential pair is incomplete');
    return null;
  }
  if (!settings.username || !protectedStorageAvailable(safeStorage, platform)) {
    throw new Error('legacy migration credential pair is unavailable');
  }
  let password = '';
  try {
    password = safeStorage.decryptString(encryptedCredential);
    return new LegacyMigrationCredentialOwner(settings.username, password);
  } catch (error) {
    throw new Error('legacy migration credential could not be decrypted', { cause: error });
  } finally {
    password = '';
    if (parsed && typeof parsed === 'object') parsed.username = '';
  }
}

module.exports = {
  LegacyMigrationCredentialOwner,
  LegacyMigrationPayloadOwner,
  openLegacyMigrationCredential,
  readLegacyMigrationPayloads,
};
