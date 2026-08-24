'use strict';

const crypto = require('node:crypto');
const {
  normalizeGatewayOrigin,
  validateOpaqueKey,
  validateProfileId,
  validateProtocolFamily,
} = require('./school-profile-schema');
const { LEGACY_HKUST_BROWSER_PARTITION } = require('./profile-workspace-layout');

const MIGRATION_JOURNAL_VERSION = 1;
const LEGACY_SOURCE_IDS = Object.freeze([
  'settings',
  'settingsBackup',
  'vpnCredential',
  'routingRules',
  'externalPac',
  'browserPac',
  'siteCredentials',
  'certificateTrust',
  'engineOwner',
  'credentialTransaction',
  'proxyCredential',
  'proxyHelperCredential',
  'engineLog',
  'engineLogRotated',
  'engineLogRetention',
]);
const DESTINATION_RECEIPT_IDS = Object.freeze([
  'globalSettings',
  'globalProxyCredential',
  'globalProxyHelperCredential',
  'globalEngineOwner',
  'globalUpdateState',
  'globalActiveContextSwitch',
  'profileSettings',
  'profileState',
  'account',
  'vpnCredential',
  'credentialTransaction',
  'deletionTombstone',
  'workspaceState',
  'siteCredentials',
  'certificateTrust',
  'routingRules',
  'externalPac',
  'browserPac',
  'localResources',
  'favorites',
  'recentResources',
  'externalIntegrations',
  'engineLog',
  'engineLogRotated',
  'engineLogRetention',
]);
const JOURNAL_STATES = Object.freeze(['prepared', 'committed']);
const HEX_DIGEST = /^[a-f0-9]{64}$/u;

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exactKeys(value, allowed, name) {
  const object = plainObject(value, name);
  const keys = Object.keys(object).sort();
  const expected = [...allowed].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} has an invalid schema`);
  }
  return object;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function normalizeReceipt(value, name) {
  const source = exactKeys(value, ['present', 'bytes', 'sha256'], name);
  if (typeof source.present !== 'boolean' || !Number.isSafeInteger(source.bytes) ||
      source.bytes < 0 || source.bytes > 64 * 1024 * 1024) {
    throw new TypeError(`${name} is invalid`);
  }
  if (!source.present) {
    if (source.bytes !== 0 || source.sha256 !== null) throw new TypeError(`${name} is invalid`);
  } else if (typeof source.sha256 !== 'string' ||
      !HEX_DIGEST.test(source.sha256)) {
    throw new TypeError(`${name} is invalid`);
  }
  return Object.freeze({
    present: source.present,
    bytes: source.bytes,
    sha256: source.sha256,
  });
}

function normalizeReceiptSet(value, ids, name) {
  const source = exactKeys(value, ids, name);
  return Object.freeze(Object.fromEntries(ids.map((id) => [
    id,
    normalizeReceipt(source[id], `${name} ${id}`),
  ])));
}

function receiptSetDigest(receipts, ids) {
  const canonical = ids.map((id) => [
    id,
    receipts[id].present,
    receipts[id].bytes,
    receipts[id].sha256,
  ]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function journalKey(prefix, randomBytes) {
  const entropy = randomBytes(16);
  if (!Buffer.isBuffer(entropy) || entropy.length !== 16) {
    throw new TypeError('migration journal entropy is invalid');
  }
  try {
    return `${prefix}-${entropy.toString('hex')}`;
  } finally {
    entropy.fill(0);
  }
}

function normalizedIdentity(value) {
  const source = exactKeys(value, ['profileKey', 'accountKey', 'workspaceKey'], 'migration identity');
  const identity = {
    profileKey: validateOpaqueKey(source.profileKey, 'profileKey'),
    accountKey: validateOpaqueKey(source.accountKey, 'accountKey'),
    workspaceKey: validateOpaqueKey(source.workspaceKey, 'workspaceKey'),
  };
  if (new Set(Object.values(identity)).size !== 3) {
    throw new TypeError('migration identity keys must be distinct');
  }
  return Object.freeze(identity);
}

function validateMigrationJournal(value) {
  const source = exactKeys(value, [
    'schemaVersion', 'state', 'migrationId', 'profileId', 'profileRevision',
    'profileCredentialBindingRevision', 'gatewayOrigin', 'protocolFamily', 'identity',
    'accountRevision', 'accountCredentialRevision', 'activeContextEpoch',
    'legacyBrowserPartition', 'sourceReceipts', 'sourceSetSha256',
    'destinationReceipts', 'destinationSetSha256', 'createdAt', 'committedAt',
  ], 'migration journal');
  if (source.schemaVersion !== MIGRATION_JOURNAL_VERSION ||
      !JOURNAL_STATES.includes(source.state)) {
    throw new TypeError('migration journal version or state is unsupported');
  }
  const sourceReceipts = normalizeReceiptSet(
    source.sourceReceipts,
    LEGACY_SOURCE_IDS,
    'source receipt set',
  );
  const expectedSourceDigest = receiptSetDigest(sourceReceipts, LEGACY_SOURCE_IDS);
  if (source.sourceSetSha256 !== expectedSourceDigest) {
    throw new TypeError('source receipt set digest does not match');
  }
  let destinationReceipts = null;
  let destinationSetSha256 = null;
  let committedAt = null;
  if (source.state === 'prepared') {
    if (source.destinationReceipts !== null || source.destinationSetSha256 !== null ||
        source.committedAt !== null) {
      throw new TypeError('prepared migration journal contains committed state');
    }
  } else {
    destinationReceipts = normalizeReceiptSet(
      source.destinationReceipts,
      DESTINATION_RECEIPT_IDS,
      'destination receipt set',
    );
    destinationSetSha256 = receiptSetDigest(destinationReceipts, DESTINATION_RECEIPT_IDS);
    if (source.destinationSetSha256 !== destinationSetSha256) {
      throw new TypeError('destination receipt set digest does not match');
    }
    committedAt = positiveInteger(source.committedAt, 'committedAt');
  }
  const createdAt = positiveInteger(source.createdAt, 'createdAt');
  if (committedAt !== null && committedAt < createdAt) {
    throw new TypeError('migration journal timestamps are inconsistent');
  }
  if (source.legacyBrowserPartition !== LEGACY_HKUST_BROWSER_PARTITION) {
    throw new TypeError('migration journal Browser partition is invalid');
  }
  const profileId = validateProfileId(source.profileId);
  if (profileId !== 'hkustgz') {
    throw new TypeError('legacy Browser partition migration is limited to the HKUST profile');
  }
  return deepFreeze({
    schemaVersion: MIGRATION_JOURNAL_VERSION,
    state: source.state,
    migrationId: validateOpaqueKey(source.migrationId, 'migrationId'),
    profileId,
    profileRevision: positiveInteger(source.profileRevision, 'profileRevision'),
    profileCredentialBindingRevision: positiveInteger(
      source.profileCredentialBindingRevision,
      'profileCredentialBindingRevision',
    ),
    gatewayOrigin: normalizeGatewayOrigin(source.gatewayOrigin).origin,
    protocolFamily: validateProtocolFamily(source.protocolFamily),
    identity: normalizedIdentity(source.identity),
    accountRevision: positiveInteger(source.accountRevision, 'accountRevision'),
    accountCredentialRevision: positiveInteger(
      source.accountCredentialRevision,
      'accountCredentialRevision',
    ),
    activeContextEpoch: positiveInteger(source.activeContextEpoch, 'activeContextEpoch'),
    legacyBrowserPartition: source.legacyBrowserPartition,
    sourceReceipts,
    sourceSetSha256: expectedSourceDigest,
    destinationReceipts,
    destinationSetSha256,
    createdAt,
    committedAt,
  });
}

function createPreparedMigrationJournal({
  profileId,
  profileRevision,
  profileCredentialBindingRevision,
  gatewayOrigin,
  protocolFamily,
  sourceReceipts,
  randomBytes = crypto.randomBytes,
  now = Date.now,
} = {}) {
  if (typeof randomBytes !== 'function' || typeof now !== 'function') {
    throw new TypeError('migration journal dependencies are invalid');
  }
  const document = {
    schemaVersion: MIGRATION_JOURNAL_VERSION,
    state: 'prepared',
    migrationId: journalKey('migration', randomBytes),
    profileId,
    profileRevision,
    profileCredentialBindingRevision,
    gatewayOrigin,
    protocolFamily,
    identity: {
      profileKey: journalKey('profile', randomBytes),
      accountKey: journalKey('account', randomBytes),
      workspaceKey: journalKey('workspace', randomBytes),
    },
    accountRevision: 1,
    accountCredentialRevision: 1,
    activeContextEpoch: 1,
    legacyBrowserPartition: LEGACY_HKUST_BROWSER_PARTITION,
    sourceReceipts,
    sourceSetSha256: receiptSetDigest(
      normalizeReceiptSet(sourceReceipts, LEGACY_SOURCE_IDS, 'source receipt set'),
      LEGACY_SOURCE_IDS,
    ),
    destinationReceipts: null,
    destinationSetSha256: null,
    createdAt: now(),
    committedAt: null,
  };
  return validateMigrationJournal(document);
}

function commitMigrationJournal(document, { destinationReceipts, now = Date.now } = {}) {
  const prepared = validateMigrationJournal(document);
  if (prepared.state !== 'prepared') {
    throw new TypeError('only a prepared migration journal can commit');
  }
  if (typeof now !== 'function') throw new TypeError('migration journal clock is invalid');
  const normalizedDestinations = normalizeReceiptSet(
    destinationReceipts,
    DESTINATION_RECEIPT_IDS,
    'destination receipt set',
  );
  return validateMigrationJournal({
    ...prepared,
    state: 'committed',
    destinationReceipts: normalizedDestinations,
    destinationSetSha256: receiptSetDigest(normalizedDestinations, DESTINATION_RECEIPT_IDS),
    committedAt: now(),
  });
}

module.exports = {
  DESTINATION_RECEIPT_IDS,
  LEGACY_SOURCE_IDS,
  MIGRATION_JOURNAL_VERSION,
  commitMigrationJournal,
  createPreparedMigrationJournal,
  validateMigrationJournal,
};
