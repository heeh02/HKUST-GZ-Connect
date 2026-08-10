'use strict';

const crypto = require('node:crypto');
const util = require('node:util');
const {
  atomicWritePrivateFile,
  protectedStorageAvailable,
} = require('./credential-store');
const { readPrivateFileBounded } = require('./private-file');
const { RANDOM_SECRET_BYTES } = require('./proxy-credential');

const DOCUMENT_VERSION = 1;
const MAX_ENCRYPTED_PROXY_CREDENTIAL_BYTES = 64 * 1024;

function storageError(message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = 'PROXY_CREDENTIAL_STORAGE_UNAVAILABLE';
  return error;
}

function validSecret(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    return Buffer.from(value, 'base64url').length === RANDOM_SECRET_BYTES &&
      Buffer.from(value, 'base64url').toString('base64url') === value;
  } catch {
    return false;
  }
}

function generateSecret(randomBytes) {
  const bytes = randomBytes(RANDOM_SECRET_BYTES);
  if (!Buffer.isBuffer(bytes) || bytes.length !== RANDOM_SECRET_BYTES) {
    throw storageError('secure proxy credential generation failed');
  }
  return bytes.toString('base64url');
}

class StableProxyCredential {
  #username;
  #password;
  #destroyed = false;

  constructor(username, password) {
    if (!validSecret(username) || !validSecret(password) || username === password) {
      throw storageError('saved proxy credential is invalid');
    }
    this.#username = Buffer.from(username, 'ascii');
    this.#password = Buffer.from(password, 'ascii');
  }

  copyForEngine() {
    if (this.#destroyed) throw storageError('proxy credential is unavailable');
    return {
      username: Buffer.from(this.#username),
      password: Buffer.from(this.#password),
    };
  }

  withStrings(callback) {
    if (this.#destroyed || typeof callback !== 'function') {
      throw storageError('proxy credential is unavailable');
    }
    return callback(this.#username.toString('ascii'), this.#password.toString('ascii'));
  }

  destroy() {
    if (this.#destroyed) return false;
    this.#username.fill(0);
    this.#password.fill(0);
    this.#destroyed = true;
    return true;
  }

  toJSON() {
    return { type: 'StableProxyCredential', redacted: true, destroyed: this.#destroyed };
  }

  [util.inspect.custom]() {
    return `StableProxyCredential { <redacted>, destroyed: ${this.#destroyed} }`;
  }
}

class ExternalProxyCredentialStore {
  constructor({
    filePath,
    safeStorage,
    platform = process.platform,
    randomBytes = crypto.randomBytes,
    fileSystem,
  } = {}) {
    if (typeof filePath !== 'string' || !filePath ||
        !safeStorage || typeof randomBytes !== 'function') {
      throw new TypeError('external proxy credential store options are invalid');
    }
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.platform = platform;
    this.randomBytes = randomBytes;
    this.fileSystem = fileSystem;
  }

  encryptionAvailable() {
    try {
      return protectedStorageAvailable(this.safeStorage, this.platform);
    } catch {
      return false;
    }
  }

  load() {
    if (!this.encryptionAvailable()) {
      throw storageError('system secure storage is unavailable');
    }
    let encrypted;
    try {
      encrypted = readPrivateFileBounded(this.filePath, {
        maxBytes: MAX_ENCRYPTED_PROXY_CREDENTIAL_BYTES,
        platform: this.platform,
        fileSystem: this.fileSystem,
      }).data;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw storageError('saved proxy credential cannot be read', error);
    }
    let plaintext = '';
    try {
      plaintext = this.safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(plaintext);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
          parsed.version !== DOCUMENT_VERSION || !validSecret(parsed.username) ||
          !validSecret(parsed.password) || parsed.username === parsed.password) {
        throw new Error('invalid proxy credential document');
      }
      return new StableProxyCredential(parsed.username, parsed.password);
    } catch (error) {
      throw storageError('saved proxy credential cannot be decrypted', error);
    } finally {
      plaintext = '';
      encrypted.fill(0);
    }
  }

  create() {
    if (!this.encryptionAvailable()) {
      throw storageError('system secure storage is unavailable');
    }
    const username = generateSecret(this.randomBytes);
    const password = generateSecret(this.randomBytes);
    if (username === password) throw storageError('secure proxy credential generation failed');
    const credential = new StableProxyCredential(username, password);
    let encrypted = null;
    try {
      encrypted = this.safeStorage.encryptString(JSON.stringify({
        version: DOCUMENT_VERSION,
        username,
        password,
      }));
      if (!Buffer.isBuffer(encrypted) || !encrypted.length ||
          encrypted.length > MAX_ENCRYPTED_PROXY_CREDENTIAL_BYTES) {
        throw new Error('invalid encrypted proxy credential');
      }
      if (!atomicWritePrivateFile(this.filePath, encrypted, this.fileSystem)) {
        throw new Error('could not persist proxy credential');
      }
      return credential;
    } catch (error) {
      credential.destroy();
      throw storageError('proxy credential could not be saved', error);
    } finally {
      encrypted?.fill(0);
    }
  }

  loadOrCreate() {
    const existing = this.load();
    return existing || this.create();
  }
}

module.exports = {
  DOCUMENT_VERSION,
  ExternalProxyCredentialStore,
  MAX_ENCRYPTED_PROXY_CREDENTIAL_BYTES,
  StableProxyCredential,
  validSecret,
};
