'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  DESTINATION_RECEIPT_IDS,
  LEGACY_SOURCE_IDS,
  REQUIRED_ABSENT_LEGACY_SOURCE_IDS,
  createPreparedMigrationJournal,
} = require('../../../../../lib/persistence/migration/legacy-hkust/profile-workspace-migration-journal');
const { normalizeSettings } = require('../../../../../lib/settings-store');
const {
  LEGACY_COPY_SOURCE_IDS,
  createHkustMigrationDestinationPlan,
} = require('../../../../../lib/persistence/migration/legacy-hkust/hkust-migration-destination-plan');
const {
  validateCampusAccountDocument,
  validateWorkspaceScopeDocument,
} = require('../../../../../lib/profiles/schema/school-profile-schema');
const {
  validateLegacyCredentialRollbackState,
} = require('../../../../../lib/persistence/migration/legacy-hkust/legacy-credential-rollback-state');

function receipt(value) {
  if (value === null) return Object.freeze({ present: false, bytes: 0, sha256: null });
  return Object.freeze({
    present: true,
    bytes: value.length,
    sha256: crypto.createHash('sha256').update(value).digest('hex'),
  });
}

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value) => Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5),
    decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0xa5).toString('utf8'),
  };
}

function fixture({ withCredential = true } = {}) {
  const settings = normalizeSettings({
    username: withCredential ? 'synthetic-user' : '',
    port: 6180,
    autoReconnect: true,
    maxAttempts: 4,
    startAtLogin: true,
    autoConnect: false,
    strictProxyAuth: true,
    closeAction: 'minimize',
    language: 'en',
    updateCheckedAt: 1_700_000_000_000,
    routeDomains: ['hkust-gz.edu.cn'],
    customResources: [{
      id: 'local-synthetic',
      name: 'Synthetic Site',
      description: 'Synthetic fixture',
      url: 'https://example.edu/',
      route: 'campus',
    }],
  });
  const settingsBytes = Buffer.from(JSON.stringify(settings), 'utf8');
  const legacyCredential = withCredential ? Buffer.from('legacy-encrypted-password') : null;
  const payloads = Object.fromEntries(LEGACY_COPY_SOURCE_IDS.map((id) => [
    id,
    Buffer.from(`legacy-${id}`, 'utf8'),
  ]));
  const sources = {};
  for (const id of LEGACY_SOURCE_IDS) {
    let value = null;
    if (id === 'settings' || id === 'settingsBackup') value = settingsBytes;
    else if (id === 'vpnCredential') value = legacyCredential;
    else if (Object.hasOwn(payloads, id)) value = payloads[id];
    if (REQUIRED_ABSENT_LEGACY_SOURCE_IDS.includes(id)) value = null;
    sources[id] = receipt(value);
  }
  let entropy = 1;
  const journal = createPreparedMigrationJournal({
    profileId: 'hkustgz',
    profileRevision: 1,
    profileCredentialBindingRevision: 1,
    gatewayOrigin: 'https://remote.hkust-gz.edu.cn',
    protocolFamily: 'easyconnect-password-modern-l3-v1',
    sourceReceipts: sources,
    randomBytes: () => Buffer.alloc(16, entropy++),
    now: () => 1_700_000_000_000,
  });
  const credentialOwner = withCredential ? {
    withStrings(callback) { return callback('synthetic-user', 'synthetic-password'); },
  } : null;
  return {
    journal,
    settingsBytes,
    legacyCredential,
    payloads,
    credentialOwner,
    protectedStorage: safeStorage(),
  };
}

function parseJson(buffer) { return JSON.parse(buffer.toString('utf8')); }

test('planner produces every exact destination without plaintext identity leakage', () => {
  const value = fixture();
  const plan = createHkustMigrationDestinationPlan({
    ...value,
    now: () => 1_700_000_000_100,
    platform: 'darwin',
  });
  assert.deepEqual(Object.keys(plan.files), [...DESTINATION_RECEIPT_IDS]);
  const globalSettings = parseJson(plan.files.globalSettings);
  assert.equal(globalSettings.port, 6180);
  assert.equal(globalSettings.language, 'en');
  assert.equal(Object.hasOwn(globalSettings, 'username'), false);
  assert.equal(Object.hasOwn(globalSettings, 'customResources'), false);
  const workspaceSettings = parseJson(plan.files.workspaceSettings);
  assert.equal(workspaceSettings.autoConnect, false);
  assert.equal(workspaceSettings.maxAttempts, 4);
  assert.deepEqual(workspaceSettings.routeDomains, ['hkust-gz.edu.cn']);

  const account = validateCampusAccountDocument(parseJson(plan.files.account));
  const workspace = validateWorkspaceScopeDocument(parseJson(plan.files.workspaceState), { account });
  assert.equal(account.accountKey, value.journal.identity.accountKey);
  assert.equal(workspace.workspaceKey, value.journal.identity.workspaceKey);
  assert.equal(account.activeCredentialVersion, 1);
  assert.equal(parseJson(plan.files.localResources).resources.length, 1);
  assert.equal(Object.hasOwn(parseJson(plan.files.localResources).resources[0], 'builtin'), false);
  assert.equal(parseJson(plan.files.favorites).entries.length, 0);
  assert.equal(parseJson(plan.files.recentResources).entries.length, 0);
  assert.equal(parseJson(plan.files.externalIntegrations).entries.length, 0);

  const rollback = validateLegacyCredentialRollbackState(
    parseJson(plan.files.legacyCredentialRollbackState),
  );
  assert.equal(rollback.state, 'active');
  assert.deepEqual(plan.files.legacyCredentialRollbackBlob, value.legacyCredential);
  assert.notDeepEqual(plan.files.vpnCredential, value.legacyCredential);
  assert.deepEqual(plan.files.globalProxyCredential, value.payloads.proxyCredential);
  assert.notEqual(plan.files.globalProxyCredential, value.payloads.proxyCredential);
  assert.notEqual(plan.files.legacyCredentialRollbackBlob, value.legacyCredential);
  const plannedProxy = Buffer.from(plan.files.globalProxyCredential);
  value.payloads.proxyCredential.fill(0);
  value.legacyCredential.fill(0);
  assert.deepEqual(plan.files.globalProxyCredential, plannedProxy);
  assert.equal(plan.files.legacyCredentialRollbackBlob.equals(Buffer.alloc(
    plan.files.legacyCredentialRollbackBlob.length,
  )), false);
  for (const buffer of Object.values(plan.files)) {
    if (!Buffer.isBuffer(buffer)) continue;
    assert.equal(buffer.includes(Buffer.from('synthetic-user')), false);
    assert.equal(buffer.includes(Buffer.from('synthetic-password')), false);
  }
});

test('planner requires username, password owner and legacy ciphertext to agree as one identity', () => {
  const value = fixture();
  assert.throws(() => createHkustMigrationDestinationPlan({
    ...value,
    credentialOwner: { withStrings(callback) { return callback('other-user', 'password'); } },
    now: () => 1_700_000_000_100,
    platform: 'darwin',
  }), /username does not match/u);
  assert.throws(() => createHkustMigrationDestinationPlan({
    ...value,
    credentialOwner: null,
    now: () => 1_700_000_000_100,
    platform: 'darwin',
  }), /credential pair/u);

  const withoutCredential = fixture({ withCredential: false });
  const plan = createHkustMigrationDestinationPlan({
    ...withoutCredential,
    now: () => 1_700_000_000_100,
    platform: 'darwin',
  });
  assert.equal(plan.files.vpnCredential, null);
  assert.equal(plan.files.legacyCredentialRollbackBlob, null);
  assert.equal(parseJson(plan.files.legacyCredentialRollbackState).state, 'retired');
});

test('every copied payload and credential ciphertext must match its journal source receipt', () => {
  const value = fixture();
  assert.throws(() => createHkustMigrationDestinationPlan({
    ...value,
    payloads: { ...value.payloads, routingRules: Buffer.from('changed') },
    now: () => 1_700_000_000_100,
    platform: 'darwin',
  }), /source receipt/u);
  assert.throws(() => createHkustMigrationDestinationPlan({
    ...value,
    legacyCredential: Buffer.from('changed'),
    now: () => 1_700_000_000_100,
    platform: 'darwin',
  }), /source receipt/u);
});

test('planner rejects malformed settings and unexpected payload fields without mutating inputs', () => {
  const value = fixture();
  const settingsCopy = Buffer.from(value.settingsBytes);
  const credentialCopy = Buffer.from(value.legacyCredential);
  assert.throws(() => createHkustMigrationDestinationPlan({
    ...value,
    settingsBytes: Buffer.from('{broken'),
    now: () => 1_700_000_000_100,
    platform: 'darwin',
  }), /settings/u);
  assert.throws(() => createHkustMigrationDestinationPlan({
    ...value,
    payloads: { ...value.payloads, arbitrary: Buffer.from('bad') },
    now: () => 1_700_000_000_100,
    platform: 'darwin',
  }), /payload schema/u);
  assert.deepEqual(value.settingsBytes, settingsCopy);
  assert.deepEqual(value.legacyCredential, credentialCopy);
});
