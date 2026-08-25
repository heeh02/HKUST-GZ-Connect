'use strict';

const util = require('node:util');
const {
  normalizeGatewayOrigin,
  validateOpaqueKey,
  validateProfileId,
  validateProtocolFamily,
} = require('../../profiles/schema/school-profile-schema');

const VPN_CREDENTIAL_ENVELOPE_VERSION = 1;
const MAX_ENCRYPTED_ENVELOPE_BYTES = 64 * 1024;
const MAX_PLAINTEXT_ENVELOPE_BYTES = 16 * 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, name) {
  const source = plainObject(value, name);
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} has an invalid schema`);
  }
  return source;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function normalizeBinding(value) {
  const source = exactKeys(value, [
    'profileId', 'profileCredentialBindingRevision', 'accountKey',
    'accountCredentialRevision', 'gatewayOrigin', 'protocolFamily',
  ], 'VPN credential binding');
  return Object.freeze({
    profileId: validateProfileId(source.profileId),
    profileCredentialBindingRevision: positiveInteger(
      source.profileCredentialBindingRevision,
      'profileCredentialBindingRevision',
    ),
    accountKey: validateOpaqueKey(source.accountKey, 'accountKey'),
    accountCredentialRevision: positiveInteger(
      source.accountCredentialRevision,
      'accountCredentialRevision',
    ),
    gatewayOrigin: normalizeGatewayOrigin(source.gatewayOrigin).origin,
    protocolFamily: validateProtocolFamily(source.protocolFamily),
  });
}

function bindingProjection(value) {
  return {
    profileId: value.profileId,
    profileCredentialBindingRevision: value.profileCredentialBindingRevision,
    accountKey: value.accountKey,
    accountCredentialRevision: value.accountCredentialRevision,
    gatewayOrigin: value.gatewayOrigin,
    protocolFamily: value.protocolFamily,
  };
}

function credentialField(value, maxLength) {
  if (typeof value !== 'string' || !value || value.length > maxLength ||
      CONTROL_CHARACTERS.test(value)) {
    throw new TypeError('VPN credential field is invalid');
  }
  return value;
}

function protectedStorageAvailable(safeStorage, platform) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' ||
      typeof safeStorage.encryptString !== 'function' ||
      typeof safeStorage.decryptString !== 'function' ||
      !['darwin', 'linux', 'win32'].includes(platform)) {
    return false;
  }
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return platform !== 'linux' || (
      typeof safeStorage.getSelectedStorageBackend === 'function' &&
      safeStorage.getSelectedStorageBackend() !== 'basic_text'
    );
  } catch {
    return false;
  }
}

function normalizeEnvelope(value) {
  const source = exactKeys(value, [
    'schemaVersion', 'profileId', 'profileCredentialBindingRevision', 'accountKey',
    'accountCredentialRevision', 'gatewayOrigin', 'protocolFamily', 'credentialVersion',
    'username', 'password', 'updatedAt',
  ], 'VPN credential envelope');
  if (source.schemaVersion !== VPN_CREDENTIAL_ENVELOPE_VERSION) {
    throw new TypeError('VPN credential envelope version is unsupported');
  }
  const binding = normalizeBinding(bindingProjection(source));
  return {
    schemaVersion: VPN_CREDENTIAL_ENVELOPE_VERSION,
    ...binding,
    credentialVersion: positiveInteger(source.credentialVersion, 'credentialVersion'),
    username: credentialField(source.username, 256),
    password: credentialField(source.password, 4096),
    updatedAt: positiveInteger(source.updatedAt, 'updatedAt'),
  };
}

function sameBinding(left, right) {
  return left.profileId === right.profileId &&
    left.profileCredentialBindingRevision === right.profileCredentialBindingRevision &&
    left.accountKey === right.accountKey &&
    left.accountCredentialRevision === right.accountCredentialRevision &&
    left.gatewayOrigin === right.gatewayOrigin &&
    left.protocolFamily === right.protocolFamily;
}

class DecryptedVpnCredential {
  #username;
  #password;
  #destroyed = false;

  constructor(envelope) {
    this.binding = normalizeBinding(bindingProjection(envelope));
    this.credentialVersion = envelope.credentialVersion;
    this.updatedAt = envelope.updatedAt;
    this.#username = Buffer.from(envelope.username, 'utf8');
    this.#password = Buffer.from(envelope.password, 'utf8');
    Object.freeze(this.binding);
    Object.freeze(this);
  }

  withStrings(callback) {
    if (this.#destroyed) throw new Error('VPN credential owner is destroyed');
    if (typeof callback !== 'function') throw new TypeError('VPN credential callback is required');
    return callback(this.#username.toString('utf8'), this.#password.toString('utf8'));
  }

  withUsername(callback) {
    if (this.#destroyed) throw new Error('VPN credential owner is destroyed');
    if (typeof callback !== 'function') throw new TypeError('VPN username callback is required');
    return callback(this.#username.toString('utf8'));
  }

  destroy() {
    if (this.#destroyed) return false;
    this.#destroyed = true;
    this.#username.fill(0);
    this.#password.fill(0);
    return true;
  }

  toJSON() { return '[redacted vpn credential]'; }

  toString() { return '[redacted vpn credential]'; }

  [util.inspect.custom]() { return '[redacted vpn credential]'; }
}

function encryptVpnCredentialEnvelope(options = {}) {
  const source = exactKeys(options, [
    'binding', 'credentialVersion', 'username', 'password', 'updatedAt', 'safeStorage', 'platform',
  ], 'VPN credential encryption request');
  if (!protectedStorageAvailable(source.safeStorage, source.platform)) {
    throw new Error('protected storage is unavailable');
  }
  const envelope = normalizeEnvelope({
    schemaVersion: VPN_CREDENTIAL_ENVELOPE_VERSION,
    ...normalizeBinding(source.binding),
    credentialVersion: source.credentialVersion,
    username: source.username,
    password: source.password,
    updatedAt: source.updatedAt,
  });
  let plaintext = JSON.stringify(envelope);
  let encrypted;
  try {
    if (Buffer.byteLength(plaintext, 'utf8') > MAX_PLAINTEXT_ENVELOPE_BYTES) {
      throw new TypeError('VPN credential envelope is too large');
    }
    encrypted = source.safeStorage.encryptString(plaintext);
  } catch (error) {
    throw new Error('VPN credential envelope encryption failed', { cause: error });
  } finally {
    plaintext = '';
    envelope.username = '';
    envelope.password = '';
  }
  if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 ||
      encrypted.length > MAX_ENCRYPTED_ENVELOPE_BYTES) {
    encrypted?.fill?.(0);
    throw new Error('VPN credential envelope encryption returned invalid data');
  }
  return encrypted;
}

function clearParsedStrings(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') value[key] = '';
    else clearParsedStrings(entry, seen);
  }
}

function decryptVpnCredentialEnvelope(encrypted, options = {}) {
  const source = exactKeys(options, ['expectedBinding', 'safeStorage', 'platform'],
    'VPN credential decryption request');
  if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 ||
      encrypted.length > MAX_ENCRYPTED_ENVELOPE_BYTES) {
    throw new TypeError('encrypted VPN credential envelope is invalid');
  }
  if (!protectedStorageAvailable(source.safeStorage, source.platform)) {
    throw new Error('protected storage is unavailable');
  }
  const expectedBinding = normalizeBinding(source.expectedBinding);
  let plaintext = '';
  let parsed = null;
  try {
    plaintext = source.safeStorage.decryptString(encrypted);
    if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext, 'utf8') < 2 ||
        Buffer.byteLength(plaintext, 'utf8') > MAX_PLAINTEXT_ENVELOPE_BYTES) {
      throw new Error('decrypted VPN credential envelope is invalid');
    }
    try {
      parsed = JSON.parse(plaintext);
    } catch (error) {
      throw new Error('VPN credential envelope JSON is invalid', { cause: error });
    }
    const envelope = normalizeEnvelope(parsed);
    if (!sameBinding(envelope, expectedBinding)) {
      throw new Error('VPN credential envelope binding does not match');
    }
    return new DecryptedVpnCredential(envelope);
  } finally {
    plaintext = '';
    clearParsedStrings(parsed);
  }
}

module.exports = {
  MAX_ENCRYPTED_ENVELOPE_BYTES,
  VPN_CREDENTIAL_ENVELOPE_VERSION,
  DecryptedVpnCredential,
  decryptVpnCredentialEnvelope,
  encryptVpnCredentialEnvelope,
};
