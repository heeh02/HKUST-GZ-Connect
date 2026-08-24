'use strict';

const crypto = require('node:crypto');
const { normalizeSettings } = require('./settings-store');
const { parseCredentialField } = require('./settings-update');
const {
  DESTINATION_RECEIPT_IDS,
  validateMigrationJournal,
} = require('./profile-workspace-migration-journal');
const {
  createLegacyCredentialRollbackState,
} = require('./legacy-credential-rollback-state');
const {
  validateGlobalSettingsDocument,
  validateGlobalUpdateStateDocument,
  validateProfileSettingsDocument,
  validateProfileStateDocument,
  validateWorkspaceSettingsDocument,
} = require('./profile-workspace-documents');
const {
  validateCampusAccountDocument,
  validateWorkspaceScopeDocument,
} = require('./school-profile-schema');
const { encryptVpnCredentialEnvelope } = require('./vpn-credential-envelope');

const LEGACY_COPY_SOURCE_IDS = Object.freeze([
  'proxyCredential',
  'routingRules',
  'externalPac',
  'browserPac',
  'siteCredentials',
  'certificateTrust',
  'engineLog',
  'engineLogRotated',
  'engineLogRetention',
]);
const MAX_LEGACY_SETTINGS_BYTES = 512 * 1024;

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
    throw new TypeError(`${name} has an invalid payload schema`);
  }
  return source;
}

function receiptFor(value) {
  if (value === null) return { present: false, bytes: 0, sha256: null };
  if (!Buffer.isBuffer(value)) throw new TypeError('legacy source payload must be a Buffer or null');
  return {
    present: true,
    bytes: value.length,
    sha256: crypto.createHash('sha256').update(value).digest('hex'),
  };
}

function sameReceipt(left, right) {
  return left.present === right.present && left.bytes === right.bytes && left.sha256 === right.sha256;
}

function requireSourceReceipt(journal, id, value) {
  const expected = journal.sourceReceipts[id];
  const observed = receiptFor(value);
  if (!expected || !sameReceipt(expected, observed)) {
    throw new Error(`legacy source receipt does not match: ${id}`);
  }
  return value;
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function copyOrNull(value) {
  return value === null ? null : Buffer.from(value);
}

function parseLegacySettings(bytes, journal) {
  requireSourceReceipt(journal, 'settings', bytes);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('legacy settings JSON is invalid', { cause: error });
  }
  try {
    return normalizeSettings(parsed);
  } catch (error) {
    throw new Error('legacy settings are invalid', { cause: error });
  }
}

function credentialPair(owner, expectedUsername) {
  if (!owner || typeof owner.withStrings !== 'function') {
    throw new Error('legacy credential pair is incomplete');
  }
  let pair = null;
  const result = owner.withStrings((username, password) => {
    const normalizedUsername = parseCredentialField(username, 'account');
    const normalizedPassword = parseCredentialField(password, 'password');
    if (!normalizedUsername || normalizedUsername.length > 256 ||
        !normalizedPassword || normalizedPassword.length > 4096) {
      throw new Error('legacy credential pair is invalid');
    }
    if (normalizedUsername !== expectedUsername) {
      throw new Error('legacy credential username does not match settings');
    }
    pair = { username: normalizedUsername, password: normalizedPassword };
    return true;
  });
  if (result && typeof result.then === 'function') {
    throw new TypeError('legacy credential access must be synchronous');
  }
  if (!pair) throw new Error('legacy credential pair is unavailable');
  return pair;
}

function createHkustMigrationDestinationPlan(options = {}) {
  const source = exactKeys(options, [
    'journal', 'settingsBytes', 'legacyCredential', 'payloads', 'credentialOwner',
    'protectedStorage', 'platform', 'now',
  ], 'HKUST destination plan request');
  const journal = validateMigrationJournal(source.journal);
  if (journal.state !== 'prepared') {
    throw new TypeError('HKUST destination plan requires a prepared journal');
  }
  if (!Buffer.isBuffer(source.settingsBytes) || source.settingsBytes.length < 2 ||
      source.settingsBytes.length > MAX_LEGACY_SETTINGS_BYTES || typeof source.now !== 'function') {
    throw new TypeError('HKUST destination plan inputs are invalid');
  }
  const settings = parseLegacySettings(source.settingsBytes, journal);
  const payloads = exactKeys(source.payloads, LEGACY_COPY_SOURCE_IDS, 'legacy copy payload');
  for (const id of LEGACY_COPY_SOURCE_IDS) requireSourceReceipt(journal, id, payloads[id]);
  requireSourceReceipt(journal, 'vpnCredential', source.legacyCredential);

  const hasLegacyCredential = journal.sourceReceipts.vpnCredential.present;
  if (hasLegacyCredential !== Boolean(settings.username) ||
      hasLegacyCredential !== Buffer.isBuffer(source.legacyCredential) ||
      hasLegacyCredential !== Boolean(source.credentialOwner)) {
    throw new Error('legacy credential pair is incomplete');
  }

  const timestamp = source.now();
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new TypeError('HKUST destination plan timestamp is invalid');
  }
  let pair = null;
  let encryptedCredential = null;
  if (hasLegacyCredential) {
    pair = credentialPair(source.credentialOwner, settings.username);
    try {
      encryptedCredential = encryptVpnCredentialEnvelope({
        binding: {
          profileId: journal.profileId,
          profileCredentialBindingRevision: journal.profileCredentialBindingRevision,
          accountKey: journal.identity.accountKey,
          accountCredentialRevision: journal.accountCredentialRevision,
          gatewayOrigin: journal.gatewayOrigin,
          protocolFamily: journal.protocolFamily,
        },
        credentialVersion: 1,
        username: pair.username,
        password: pair.password,
        updatedAt: timestamp,
        safeStorage: source.protectedStorage,
        platform: source.platform,
      });
    } finally {
      if (pair) {
        pair.username = '';
        pair.password = '';
      }
    }
  }

  const accountDocument = {
    schemaVersion: 1,
    accountKey: journal.identity.accountKey,
    accountRevision: journal.accountRevision,
    accountCredentialRevision: journal.accountCredentialRevision,
    role: 'primary',
    state: 'enabled',
    profileId: journal.profileId,
    profileRevision: journal.profileRevision,
    gatewayOrigin: journal.gatewayOrigin,
    protocolFamily: journal.protocolFamily,
    workspaceKey: journal.identity.workspaceKey,
    activeCredentialVersion: hasLegacyCredential ? 1 : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const account = validateCampusAccountDocument(accountDocument);
  const workspace = validateWorkspaceScopeDocument({
    schemaVersion: 1,
    profileId: journal.profileId,
    profileRevision: journal.profileRevision,
    accountKey: journal.identity.accountKey,
    accountRevision: journal.accountRevision,
    workspaceKey: journal.identity.workspaceKey,
    activeContextEpoch: journal.activeContextEpoch,
  }, { account });
  const rollbackState = createLegacyCredentialRollbackState({
    journal,
    sourceReceipt: journal.sourceReceipts.vpnCredential,
    now: () => timestamp,
  });

  const files = {
    globalSettings: jsonBuffer(validateGlobalSettingsDocument({
      schemaVersion: 1,
      activeProfileKey: journal.identity.profileKey,
      activeAccountKey: journal.identity.accountKey,
      port: settings.port,
      strictProxyAuth: settings.strictProxyAuth,
      proxySecurityVersion: settings.proxySecurityVersion,
      proxyAuthMigrationPending: settings.proxyAuthMigrationPending,
      closeAction: settings.closeAction,
      language: settings.language,
      startAtLogin: settings.startAtLogin,
    })),
    globalProxyCredential: copyOrNull(payloads.proxyCredential),
    globalProxyHelperCredential: null,
    globalEngineOwner: null,
    globalUpdateState: jsonBuffer(validateGlobalUpdateStateDocument({
      schemaVersion: 1,
      checkedAt: settings.updateCheckedAt,
    })),
    globalActiveContextSwitch: null,
    profileSettings: jsonBuffer(validateProfileSettingsDocument({
      schemaVersion: 1,
      profileId: journal.profileId,
      profileRevision: journal.profileRevision,
      primaryAccountKey: journal.identity.accountKey,
    })),
    profileState: jsonBuffer(validateProfileStateDocument({
      schemaVersion: 1,
      migrationId: journal.migrationId,
      profileId: journal.profileId,
      profileRevision: journal.profileRevision,
      profileCredentialBindingRevision: journal.profileCredentialBindingRevision,
      gatewayOrigin: journal.gatewayOrigin,
      protocolFamily: journal.protocolFamily,
    })),
    account: jsonBuffer(accountDocument),
    vpnCredential: encryptedCredential,
    legacyCredentialRollbackBlob: copyOrNull(source.legacyCredential),
    legacyCredentialRollbackState: jsonBuffer(rollbackState),
    legacyCredentialRollbackRetirement: null,
    credentialTransaction: null,
    deletionTombstone: null,
    workspaceSettings: jsonBuffer(validateWorkspaceSettingsDocument({
      schemaVersion: 1,
      autoReconnect: settings.autoReconnect,
      maxAttempts: settings.maxAttempts,
      autoConnect: settings.autoConnect,
      routeDomains: settings.routeDomains,
    })),
    workspaceState: jsonBuffer(workspace),
    siteCredentials: copyOrNull(payloads.siteCredentials),
    certificateTrust: copyOrNull(payloads.certificateTrust),
    routingRules: copyOrNull(payloads.routingRules),
    externalPac: copyOrNull(payloads.externalPac),
    browserPac: copyOrNull(payloads.browserPac),
    localResources: jsonBuffer({ schemaVersion: 1, resources: settings.customResources }),
    favorites: jsonBuffer({ schemaVersion: 1, entries: [] }),
    recentResources: jsonBuffer({ schemaVersion: 1, entries: [] }),
    externalIntegrations: jsonBuffer({ schemaVersion: 1, entries: [] }),
    engineLog: copyOrNull(payloads.engineLog),
    engineLogRotated: copyOrNull(payloads.engineLogRotated),
    engineLogRetention: copyOrNull(payloads.engineLogRetention),
  };
  const ids = Object.keys(files);
  if (ids.length !== DESTINATION_RECEIPT_IDS.length ||
      DESTINATION_RECEIPT_IDS.some((id) => !Object.hasOwn(files, id))) {
    encryptedCredential?.fill(0);
    throw new Error('HKUST destination plan does not match the journal schema');
  }
  return Object.freeze({ files: Object.freeze(files) });
}

module.exports = {
  LEGACY_COPY_SOURCE_IDS,
  createHkustMigrationDestinationPlan,
};
