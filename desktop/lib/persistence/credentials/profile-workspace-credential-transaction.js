'use strict';

const crypto = require('node:crypto');
const {
  normalizeGatewayOrigin,
  validateCampusAccountDocument,
  validateOpaqueKey,
  validateProfileId,
  validateProtocolFamily,
} = require('../../profiles/schema/school-profile-schema');

const CREDENTIAL_TRANSACTION_VERSION = 1;
const MAX_CREDENTIAL_TRANSACTION_BYTES = 512 * 1024;
const MAX_ACCOUNT_DOCUMENT_BYTES = 64 * 1024;
const MAX_VPN_CREDENTIAL_BYTES = 64 * 1024;
const DIGEST = /^[a-f0-9]{64}$/u;

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

function positive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function validateReceipt(value, name, { allowAbsent = false, maxBytes } = {}) {
  const source = exactKeys(value, ['present', 'bytes', 'sha256'], name);
  if (source.present === false && allowAbsent && source.bytes === 0 && source.sha256 === null) {
    return Object.freeze({ present: false, bytes: 0, sha256: null });
  }
  if (source.present !== true || !Number.isSafeInteger(source.bytes) || source.bytes < 1 ||
      source.bytes > maxBytes || typeof source.sha256 !== 'string' || !DIGEST.test(source.sha256)) {
    throw new TypeError(`${name} is invalid`);
  }
  return Object.freeze({ present: true, bytes: source.bytes, sha256: source.sha256 });
}

function receipt(data, { allowAbsent = false, maxBytes } = {}) {
  if (data === null && allowAbsent) {
    return Object.freeze({ present: false, bytes: 0, sha256: null });
  }
  if (!Buffer.isBuffer(data) || data.length < 1 || data.length > maxBytes) {
    throw new TypeError('credential transaction payload is invalid');
  }
  return Object.freeze({
    present: true,
    bytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
  });
}

function sameReceipt(left, right) {
  return left.present === right.present && left.bytes === right.bytes && left.sha256 === right.sha256;
}

function validateBinding(value) {
  const source = exactKeys(value, [
    'profileId', 'profileKey', 'profileCredentialBindingRevision', 'accountKey',
    'workspaceKey', 'activeContextEpoch', 'gatewayOrigin', 'protocolFamily',
  ], 'profile workspace credential binding');
  return Object.freeze({
    profileId: validateProfileId(source.profileId),
    profileKey: validateOpaqueKey(source.profileKey, 'profileKey'),
    profileCredentialBindingRevision: positive(
      source.profileCredentialBindingRevision,
      'profileCredentialBindingRevision',
    ),
    accountKey: validateOpaqueKey(source.accountKey, 'accountKey'),
    workspaceKey: validateOpaqueKey(source.workspaceKey, 'workspaceKey'),
    activeContextEpoch: positive(source.activeContextEpoch, 'activeContextEpoch'),
    gatewayOrigin: normalizeGatewayOrigin(source.gatewayOrigin).origin,
    protocolFamily: validateProtocolFamily(source.protocolFamily),
  });
}

function bindingFromAuthority(authority) {
  return validateBinding({
    profileId: authority.profile.profileId,
    profileKey: authority.layout.identity.profileKey,
    profileCredentialBindingRevision:
      authority.profileState.profileCredentialBindingRevision,
    accountKey: authority.account.accountKey,
    workspaceKey: authority.account.workspaceKey,
    activeContextEpoch: authority.workspaceState.activeContextEpoch,
    gatewayOrigin: authority.profile.gateway.origin.origin,
    protocolFamily: authority.profile.gateway.protocolFamily,
  });
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function encodedPayload(value, name, { allowAbsent = false, maxBytes }) {
  const source = exactKeys(value, ['receipt', 'data'], name);
  const expected = validateReceipt(source.receipt, `${name} receipt`, { allowAbsent, maxBytes });
  if (!expected.present) {
    if (source.data !== null) throw new TypeError(`${name} absent payload must be null`);
    return Object.freeze({ receipt: expected, data: null });
  }
  if (typeof source.data !== 'string') throw new TypeError(`${name} payload is invalid`);
  const data = Buffer.from(source.data, 'base64');
  if (data.toString('base64') !== source.data ||
      !sameReceipt(receipt(data, { maxBytes }), expected)) {
    data.fill(0);
    throw new TypeError(`${name} payload does not match its receipt`);
  }
  data.fill(0);
  return Object.freeze({ receipt: expected, data: source.data });
}

function validateCredentialTransaction(value, expectedBinding = null) {
  const source = exactKeys(value, [
    'schemaVersion', 'type', 'transactionId', 'binding', 'operation', 'createdAt',
    'beforeAccount', 'afterAccount', 'beforeCredential', 'afterCredential',
  ], 'profile workspace credential transaction');
  if (source.schemaVersion !== CREDENTIAL_TRANSACTION_VERSION ||
      source.type !== 'profile_workspace_credential_commit' ||
      !['replace', 'clear'].includes(source.operation)) {
    throw new TypeError('profile workspace credential transaction is unsupported');
  }
  const binding = validateBinding(source.binding);
  if (expectedBinding && !sameDocument(binding, expectedBinding)) {
    throw new Error('profile workspace credential transaction binding does not match');
  }
  return Object.freeze({
    schemaVersion: CREDENTIAL_TRANSACTION_VERSION,
    type: 'profile_workspace_credential_commit',
    transactionId: validateOpaqueKey(source.transactionId, 'transactionId'),
    binding,
    operation: source.operation,
    createdAt: positive(source.createdAt, 'createdAt'),
    beforeAccount: validateReceipt(source.beforeAccount, 'before Account receipt', {
      maxBytes: MAX_ACCOUNT_DOCUMENT_BYTES,
    }),
    afterAccount: encodedPayload(source.afterAccount, 'after Account', {
      maxBytes: MAX_ACCOUNT_DOCUMENT_BYTES,
    }),
    beforeCredential: validateReceipt(source.beforeCredential, 'before credential receipt', {
      allowAbsent: true,
      maxBytes: MAX_VPN_CREDENTIAL_BYTES,
    }),
    afterCredential: encodedPayload(source.afterCredential, 'after credential', {
      allowAbsent: true,
      maxBytes: MAX_VPN_CREDENTIAL_BYTES,
    }),
  });
}

function createNextAccountDocument(account, changes) {
  return validateCampusAccountDocument({
    schemaVersion: account.schemaVersion,
    accountKey: account.accountKey,
    accountRevision: account.accountRevision,
    accountCredentialRevision: changes.accountCredentialRevision,
    role: account.role,
    state: account.state,
    profileId: account.profileId,
    profileRevision: account.profileRevision,
    gatewayOrigin: account.gatewayOrigin.origin,
    protocolFamily: account.protocolFamily,
    workspaceKey: account.workspaceKey,
    activeCredentialVersion: changes.activeCredentialVersion,
    createdAt: account.createdAt,
    updatedAt: changes.updatedAt,
  });
}

function serializeAccountDocument(account) {
  return Buffer.from(`${JSON.stringify({
    ...account,
    gatewayOrigin: account.gatewayOrigin.origin,
  })}\n`, 'utf8');
}

module.exports = {
  CREDENTIAL_TRANSACTION_VERSION,
  MAX_ACCOUNT_DOCUMENT_BYTES,
  MAX_CREDENTIAL_TRANSACTION_BYTES,
  MAX_VPN_CREDENTIAL_BYTES,
  bindingFromAuthority,
  createNextAccountDocument,
  positive,
  receipt,
  sameDocument,
  sameReceipt,
  serializeAccountDocument,
  validateCredentialTransaction,
};
