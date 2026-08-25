'use strict';

const {
  normalizeGatewayOrigin,
  validateOpaqueKey,
  validateProfileId,
  validateProtocolFamily,
} = require('./profiles/schema/school-profile-schema');

const LEGACY_CREDENTIAL_ROLLBACK_VERSION = 1;
const LEGACY_CREDENTIAL_FORMAT = 'safe_storage_password_v1';
const RETIREMENT_REASONS = Object.freeze([
  'credential_replaced',
  'credential_cleared',
  'account_removed',
  'profile_reset',
  'no_legacy_credential',
]);
const DIGEST = /^[a-f0-9]{64}$/u;
const MAX_LEGACY_CREDENTIAL_BYTES = 64 * 1024;

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

function validateLegacyCredentialRollbackState(value) {
  const source = exactKeys(value, [
    'schemaVersion', 'state', 'legacyFormat', 'migrationId', 'profileId',
    'profileCredentialBindingRevision', 'accountKey', 'accountCredentialRevision',
    'gatewayOrigin', 'protocolFamily', 'sourceBytes', 'sourceSha256',
    'createdAt', 'retiredAt', 'retirementReason',
  ], 'legacy credential rollback state');
  if (source.schemaVersion !== LEGACY_CREDENTIAL_ROLLBACK_VERSION ||
      !['active', 'retired'].includes(source.state) ||
      source.legacyFormat !== LEGACY_CREDENTIAL_FORMAT) {
    throw new TypeError('legacy credential rollback version, state or format is unsupported');
  }
  const createdAt = positive(source.createdAt, 'createdAt');
  let retiredAt = null;
  let retirementReason = null;
  if (source.state === 'active') {
    if (!Number.isSafeInteger(source.sourceBytes) || source.sourceBytes <= 0 ||
        source.sourceBytes > MAX_LEGACY_CREDENTIAL_BYTES ||
        typeof source.sourceSha256 !== 'string' || !DIGEST.test(source.sourceSha256) ||
        source.retiredAt !== null || source.retirementReason !== null) {
      throw new TypeError('active rollback state requires one legacy credential receipt');
    }
  } else {
    if (!RETIREMENT_REASONS.includes(source.retirementReason)) {
      throw new TypeError('retired rollback state has an invalid reason');
    }
    retiredAt = positive(source.retiredAt, 'retiredAt');
    if (retiredAt < createdAt) throw new TypeError('rollback timestamps are inconsistent');
    retirementReason = source.retirementReason;
    const noCredential = retirementReason === 'no_legacy_credential';
    if (noCredential !== (source.sourceBytes === 0 && source.sourceSha256 === null) ||
        (!noCredential && (!Number.isSafeInteger(source.sourceBytes) || source.sourceBytes <= 0 ||
          source.sourceBytes > MAX_LEGACY_CREDENTIAL_BYTES ||
          typeof source.sourceSha256 !== 'string' || !DIGEST.test(source.sourceSha256)))) {
      throw new TypeError('retired rollback source receipt is invalid');
    }
  }
  return Object.freeze({
    schemaVersion: LEGACY_CREDENTIAL_ROLLBACK_VERSION,
    state: source.state,
    legacyFormat: LEGACY_CREDENTIAL_FORMAT,
    migrationId: validateOpaqueKey(source.migrationId, 'migrationId'),
    profileId: validateProfileId(source.profileId),
    profileCredentialBindingRevision: positive(
      source.profileCredentialBindingRevision,
      'profileCredentialBindingRevision',
    ),
    accountKey: validateOpaqueKey(source.accountKey, 'accountKey'),
    accountCredentialRevision: positive(
      source.accountCredentialRevision,
      'accountCredentialRevision',
    ),
    gatewayOrigin: normalizeGatewayOrigin(source.gatewayOrigin).origin,
    protocolFamily: validateProtocolFamily(source.protocolFamily),
    sourceBytes: source.sourceBytes,
    sourceSha256: source.sourceSha256,
    createdAt,
    retiredAt,
    retirementReason,
  });
}

function createLegacyCredentialRollbackState({ journal, sourceReceipt, now = Date.now } = {}) {
  if (!journal?.identity || typeof now !== 'function' || !sourceReceipt ||
      typeof sourceReceipt.present !== 'boolean') {
    throw new TypeError('legacy credential rollback inputs are invalid');
  }
  const createdAt = now();
  const present = sourceReceipt.present === true;
  return validateLegacyCredentialRollbackState({
    schemaVersion: LEGACY_CREDENTIAL_ROLLBACK_VERSION,
    state: present ? 'active' : 'retired',
    legacyFormat: LEGACY_CREDENTIAL_FORMAT,
    migrationId: journal.migrationId,
    profileId: journal.profileId,
    profileCredentialBindingRevision: journal.profileCredentialBindingRevision,
    accountKey: journal.identity.accountKey,
    accountCredentialRevision: journal.accountCredentialRevision,
    gatewayOrigin: journal.gatewayOrigin,
    protocolFamily: journal.protocolFamily,
    sourceBytes: present ? sourceReceipt.bytes : 0,
    sourceSha256: present ? sourceReceipt.sha256 : null,
    createdAt,
    retiredAt: present ? null : createdAt,
    retirementReason: present ? null : 'no_legacy_credential',
  });
}

function retireLegacyCredentialRollbackState(value, { reason, now = Date.now } = {}) {
  const current = validateLegacyCredentialRollbackState(value);
  if (current.state === 'retired') return current;
  if (!RETIREMENT_REASONS.includes(reason) || reason === 'no_legacy_credential' ||
      typeof now !== 'function') {
    throw new TypeError('legacy credential retirement request is invalid');
  }
  return validateLegacyCredentialRollbackState({
    ...current,
    state: 'retired',
    retiredAt: now(),
    retirementReason: reason,
  });
}

module.exports = {
  LEGACY_CREDENTIAL_ROLLBACK_VERSION,
  RETIREMENT_REASONS,
  createLegacyCredentialRollbackState,
  retireLegacyCredentialRollbackState,
  validateLegacyCredentialRollbackState,
};
