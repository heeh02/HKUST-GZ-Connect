'use strict';

const {
  CUSTOM_PROFILE_FILE_IDS,
} = require('./custom-profile-provisioning-plan');
const {
  validateOpaqueKey,
  validateProfileId,
  validateSchoolProfileDocument,
} = require('../schema/school-profile-schema');

const CUSTOM_PROFILE_PROVISIONING_JOURNAL_VERSION = 1;
const CUSTOM_PROFILE_PROVISIONING_TYPE = 'custom_profile_provisioning';
const STATES = Object.freeze(['prepared', 'materialized', 'indexed']);
const SHA256 = /^[a-f0-9]{64}$/u;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

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

function optionalTimestamp(value, name) {
  return value === null ? null : positive(value, name);
}

function presentReceipt(value, name) {
  const source = exactKeys(value, ['present', 'bytes', 'sha256'], name);
  if (source.present !== true || !Number.isSafeInteger(source.bytes) || source.bytes < 2 ||
      source.bytes > 512 * 1024 || typeof source.sha256 !== 'string' || !SHA256.test(source.sha256)) {
    throw new TypeError(`${name} is invalid`);
  }
  return Object.freeze({ present: true, bytes: source.bytes, sha256: source.sha256 });
}

function maybeReceipt(value, name) {
  const source = exactKeys(value, ['present', 'bytes', 'sha256'], name);
  if (source.present === false && source.bytes === 0 && source.sha256 === null) {
    return Object.freeze({ present: false, bytes: 0, sha256: null });
  }
  return presentReceipt(source, name);
}

function identity(value) {
  const source = exactKeys(value, [
    'provisioningId', 'profileId', 'profileKey', 'accountKey', 'workspaceKey',
  ], 'custom Profile provisioning identity');
  const profileId = validateProfileId(source.profileId);
  if (!profileId.startsWith('custom-')) {
    throw new TypeError('custom Profile provisioning profileId is invalid');
  }
  const result = {
    provisioningId: validateOpaqueKey(source.provisioningId, 'provisioningId'),
    profileId,
    profileKey: validateOpaqueKey(source.profileKey, 'profileKey'),
    accountKey: validateOpaqueKey(source.accountKey, 'accountKey'),
    workspaceKey: validateOpaqueKey(source.workspaceKey, 'workspaceKey'),
  };
  if (new Set([
    result.provisioningId, result.profileKey, result.accountKey, result.workspaceKey,
  ]).size !== 4) {
    throw new TypeError('custom Profile provisioning keys must be distinct');
  }
  return Object.freeze(result);
}

function fileReceipts(value) {
  const source = exactKeys(value, CUSTOM_PROFILE_FILE_IDS, 'custom Profile file receipts');
  return Object.freeze(Object.fromEntries(CUSTOM_PROFILE_FILE_IDS.map((id) => (
    [id, presentReceipt(source[id], `custom Profile file receipt ${id}`)]
  ))));
}

function indexTransition(value) {
  const source = exactKeys(value, ['entry', 'before', 'after'], 'custom Profile index transition');
  const indexEntry = exactKeys(source.entry, ['profileId', 'profileKey', 'createdAt'],
    'custom Profile index entry');
  const profileId = validateProfileId(indexEntry.profileId);
  if (!profileId.startsWith('custom-')) throw new TypeError('custom Profile index identity is invalid');
  return Object.freeze({
    entry: Object.freeze({
      profileId,
      profileKey: validateOpaqueKey(indexEntry.profileKey, 'custom Profile index profileKey'),
      createdAt: positive(indexEntry.createdAt, 'custom Profile index createdAt'),
    }),
    before: maybeReceipt(source.before, 'custom Profile index before receipt'),
    after: presentReceipt(source.after, 'custom Profile index after receipt'),
  });
}

function validateCustomProfileProvisioningJournal(value) {
  const source = exactKeys(value, [
    'schemaVersion', 'type', 'state', 'identity', 'profileDocument', 'createdAt',
    'fileReceipts', 'indexTransition', 'materializedAt', 'indexedAt',
  ], 'custom Profile provisioning journal');
  if (source.schemaVersion !== CUSTOM_PROFILE_PROVISIONING_JOURNAL_VERSION ||
      source.type !== CUSTOM_PROFILE_PROVISIONING_TYPE || !STATES.includes(source.state)) {
    throw new TypeError('custom Profile provisioning journal version or state is unsupported');
  }
  const boundIdentity = identity(source.identity);
  const profileDocument = JSON.parse(JSON.stringify(plainObject(
    source.profileDocument,
    'custom Profile source document',
  )));
  const profile = validateSchoolProfileDocument(profileDocument);
  if (profile.evidenceClass !== 'custom-local' || profile.profileId !== boundIdentity.profileId) {
    throw new TypeError('custom Profile provisioning document identity does not match');
  }
  const createdAt = positive(source.createdAt, 'custom Profile provisioning createdAt');
  const transition = indexTransition(source.indexTransition);
  if (transition.entry.profileId !== boundIdentity.profileId ||
      transition.entry.profileKey !== boundIdentity.profileKey ||
      transition.entry.createdAt !== createdAt) {
    throw new TypeError('custom Profile index transition does not match provisioning authority');
  }
  const materializedAt = optionalTimestamp(source.materializedAt, 'materializedAt');
  const indexedAt = optionalTimestamp(source.indexedAt, 'indexedAt');
  if (source.state === 'prepared' && (materializedAt !== null || indexedAt !== null) ||
      source.state === 'materialized' && (materializedAt === null || indexedAt !== null) ||
      source.state === 'indexed' && (materializedAt === null || indexedAt === null) ||
      materializedAt !== null && materializedAt < createdAt ||
      indexedAt !== null && indexedAt < materializedAt) {
    throw new TypeError('custom Profile provisioning timestamps are inconsistent');
  }
  return deepFreeze({
    schemaVersion: CUSTOM_PROFILE_PROVISIONING_JOURNAL_VERSION,
    type: CUSTOM_PROFILE_PROVISIONING_TYPE,
    state: source.state,
    identity: boundIdentity,
    profileDocument,
    createdAt,
    fileReceipts: fileReceipts(source.fileReceipts),
    indexTransition: transition,
    materializedAt,
    indexedAt,
  });
}

function createPreparedCustomProfileProvisioning({ plan, fileReceipts: receipts, indexTransition: transition } = {}) {
  if (!plan || !plan.identity || !plan.profileDocument) {
    throw new TypeError('custom Profile provisioning plan is unavailable');
  }
  return validateCustomProfileProvisioningJournal({
    schemaVersion: CUSTOM_PROFILE_PROVISIONING_JOURNAL_VERSION,
    type: CUSTOM_PROFILE_PROVISIONING_TYPE,
    state: 'prepared',
    identity: plan.identity,
    profileDocument: plan.profileDocument,
    createdAt: plan.createdAt,
    fileReceipts: receipts,
    indexTransition: transition,
    materializedAt: null,
    indexedAt: null,
  });
}

function markCustomProfileMaterialized(value, { now = Date.now } = {}) {
  const current = validateCustomProfileProvisioningJournal(value);
  if (current.state !== 'prepared' || typeof now !== 'function') {
    throw new TypeError('only prepared custom Profile provisioning can materialize');
  }
  return validateCustomProfileProvisioningJournal({
    ...current,
    state: 'materialized',
    materializedAt: now(),
  });
}

function markCustomProfileIndexed(value, { now = Date.now } = {}) {
  const current = validateCustomProfileProvisioningJournal(value);
  if (current.state !== 'materialized' || typeof now !== 'function') {
    throw new TypeError('only materialized custom Profile provisioning can index');
  }
  return validateCustomProfileProvisioningJournal({
    ...current,
    state: 'indexed',
    indexedAt: now(),
  });
}

module.exports = {
  CUSTOM_PROFILE_PROVISIONING_JOURNAL_VERSION,
  CUSTOM_PROFILE_PROVISIONING_TYPE,
  createPreparedCustomProfileProvisioning,
  markCustomProfileIndexed,
  markCustomProfileMaterialized,
  validateCustomProfileProvisioningJournal,
};
