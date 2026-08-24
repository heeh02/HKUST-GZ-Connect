'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  LEGACY_HKUST_BROWSER_PARTITION,
  createProfileAccountBootstrapLayout,
  createProfileAccountWorkspaceLayout,
} = require('../lib/profile-workspace-layout');
const {
  DESTINATION_RECEIPT_IDS,
  LEGACY_SOURCE_IDS,
  REQUIRED_ABSENT_LEGACY_SOURCE_IDS,
  commitMigrationJournal,
  createPreparedMigrationJournal,
  validateMigrationJournal,
} = require('../lib/profile-workspace-migration-journal');

const PROFILE_KEY = `profile-${'11'.repeat(16)}`;
const ACCOUNT_KEY = `account-${'22'.repeat(16)}`;
const WORKSPACE_KEY = `workspace-${'33'.repeat(16)}`;

function receipt(seed) {
  return Object.freeze({
    present: true,
    bytes: seed,
    sha256: seed.toString(16).padStart(64, '0'),
  });
}

function sourceReceipts() {
  return Object.fromEntries(LEGACY_SOURCE_IDS.map((id, index) => [
    id,
    REQUIRED_ABSENT_LEGACY_SOURCE_IDS.includes(id)
      ? Object.freeze({ present: false, bytes: 0, sha256: null })
      : receipt(index + 1),
  ]));
}

function deepKeys(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  for (const [key, entry] of Object.entries(value)) {
    result.push(key.toLowerCase());
    deepKeys(entry, result);
  }
  return result;
}

test('profile/account/workspace paths use only opaque keys beneath one absolute userData root', () => {
  const userData = path.resolve('/tmp/campus-connect-user-data');
  const layout = createProfileAccountWorkspaceLayout({
    userData,
    profileKey: PROFILE_KEY,
    accountKey: ACCOUNT_KEY,
    workspaceKey: WORKSPACE_KEY,
  });

  assert.equal(layout.global.root, path.join(userData, 'global'));
  assert.equal(
    layout.account.root,
    path.join(userData, 'profiles', PROFILE_KEY, 'accounts', ACCOUNT_KEY),
  );
  assert.equal(layout.workspace.root, path.join(layout.account.root, 'workspace'));
  assert.equal(layout.account.vpnCredential, path.join(layout.account.root, 'vpn-credential.bin'));
  assert.equal(
    layout.account.legacyCredentialRollbackState,
    path.join(layout.account.root, 'legacy-vpn-credential-rollback.json'),
  );
  assert.equal(
    layout.account.legacyCredentialRollbackRetirement,
    path.join(layout.account.root, 'legacy-vpn-credential-rollback-retirement.json'),
  );
  assert.equal(layout.workspace.routingRules, path.join(layout.workspace.root, 'routing-rules.json'));
  assert.equal(layout.workspace.engineLog, path.join(layout.workspace.root, 'engine.log'));
  assert.equal(
    layout.global.settingsTransaction,
    path.join(layout.global.root, 'profile-workspace-settings-transaction.json'),
  );
  assert.match(layout.browserPartition, /^persist:campus-workspace-[a-f0-9]{32}$/u);
  assert.equal(Object.isFrozen(layout.workspace), true);
  for (const sensitive of ['hkustgz', 'remote.hkust-gz.edu.cn', 'student001']) {
    assert.equal(JSON.stringify(layout).includes(sensitive), false);
  }
});

test('only the migrated HKUST primary workspace adopts the legacy Browser partition alias', () => {
  const input = {
    userData: path.resolve('/tmp/campus-connect-user-data'),
    profileKey: PROFILE_KEY,
    accountKey: ACCOUNT_KEY,
    workspaceKey: WORKSPACE_KEY,
  };
  assert.notEqual(createProfileAccountWorkspaceLayout(input).browserPartition,
    LEGACY_HKUST_BROWSER_PARTITION);
  assert.equal(createProfileAccountWorkspaceLayout({
    ...input,
    adoptLegacyHkustBrowserPartition: true,
  }).browserPartition, LEGACY_HKUST_BROWSER_PARTITION);
});

test('bootstrap layout discovers Account authority before the Workspace key is known', () => {
  const input = {
    userData: path.resolve('/tmp/campus-connect-user-data'),
    profileKey: PROFILE_KEY,
    accountKey: ACCOUNT_KEY,
  };
  const bootstrap = createProfileAccountBootstrapLayout(input);
  const complete = createProfileAccountWorkspaceLayout({
    ...input,
    workspaceKey: WORKSPACE_KEY,
  });
  assert.deepEqual(bootstrap.global, complete.global);
  assert.deepEqual(bootstrap.profile, complete.profile);
  assert.deepEqual(bootstrap.account, complete.account);
  assert.equal(Object.hasOwn(bootstrap, 'workspace'), false);
  assert.equal(Object.isFrozen(bootstrap.account), true);
});

test('layout rejects relative roots, traversal keys and key reuse', () => {
  const valid = {
    userData: path.resolve('/tmp/campus-connect-user-data'),
    profileKey: PROFILE_KEY,
    accountKey: ACCOUNT_KEY,
    workspaceKey: WORKSPACE_KEY,
  };
  assert.throws(() => createProfileAccountWorkspaceLayout({ ...valid, userData: 'relative' }),
    /userData/u);
  assert.throws(() => createProfileAccountWorkspaceLayout({ ...valid, profileKey: '../profile' }),
    /profileKey/u);
  assert.throws(() => createProfileAccountWorkspaceLayout({ ...valid, accountKey: PROFILE_KEY }),
    /distinct/u);
});

test('prepared migration journal generates and erases all persistent key entropy in one operation', () => {
  const entropy = [1, 2, 3, 4].map((value) => Buffer.alloc(16, value));
  let index = 0;
  const document = createPreparedMigrationJournal({
    profileId: 'hkustgz',
    profileRevision: 1,
    profileCredentialBindingRevision: 1,
    gatewayOrigin: 'https://remote.hkust-gz.edu.cn',
    protocolFamily: 'easyconnect-password-modern-l3-v1',
    sourceReceipts: sourceReceipts(),
    randomBytes: () => entropy[index++],
    now: () => 1_700_000_000_000,
  });

  assert.equal(document.state, 'prepared');
  assert.match(document.migrationId, /^migration-[a-f0-9]{32}$/u);
  assert.match(document.identity.profileKey, /^profile-[a-f0-9]{32}$/u);
  assert.match(document.identity.accountKey, /^account-[a-f0-9]{32}$/u);
  assert.match(document.identity.workspaceKey, /^workspace-[a-f0-9]{32}$/u);
  assert.equal(document.legacyBrowserPartition, LEGACY_HKUST_BROWSER_PARTITION);
  for (const buffer of entropy) assert.deepEqual(buffer, Buffer.alloc(16));
  const keys = deepKeys(document);
  for (const forbidden of ['username', 'password', 'cookie', 'token', 'csrf', 'twfid']) {
    assert.equal(keys.includes(forbidden), false);
  }
});

test('journal schema is exact, receipt-bound and has one monotonic commit transition', () => {
  let entropyValue = 10;
  const prepared = createPreparedMigrationJournal({
    profileId: 'hkustgz',
    profileRevision: 1,
    profileCredentialBindingRevision: 1,
    gatewayOrigin: 'https://remote.hkust-gz.edu.cn',
    protocolFamily: 'easyconnect-password-modern-l3-v1',
    sourceReceipts: sourceReceipts(),
    randomBytes: () => Buffer.alloc(16, entropyValue++),
    now: () => 1_700_000_000_000,
  });
  const destinationReceipts = Object.fromEntries(
    DESTINATION_RECEIPT_IDS.map((id, index) => [id, receipt(index + 101)]),
  );
  const committed = commitMigrationJournal(prepared, {
    destinationReceipts,
    now: () => 1_700_000_000_100,
  });

  assert.equal(committed.state, 'committed');
  assert.equal(committed.committedAt, 1_700_000_000_100);
  assert.deepEqual(validateMigrationJournal(JSON.parse(JSON.stringify(committed))), committed);
  assert.throws(() => commitMigrationJournal(committed, {
    destinationReceipts,
    now: () => 1_700_000_000_200,
  }), /prepared/u);
  assert.throws(() => validateMigrationJournal({ ...prepared, username: 'student001' }),
    /schema/u);
  assert.throws(() => validateMigrationJournal({
    ...prepared,
    sourceReceipts: { ...prepared.sourceReceipts, settings: receipt(999) },
  }), /source receipt/u);
});

test('journal generation fails closed on weak entropy, missing receipts and unsafe bindings', () => {
  const base = {
    profileId: 'hkustgz',
    profileRevision: 1,
    profileCredentialBindingRevision: 1,
    gatewayOrigin: 'https://remote.hkust-gz.edu.cn',
    protocolFamily: 'easyconnect-password-modern-l3-v1',
    sourceReceipts: sourceReceipts(),
    now: () => 1_700_000_000_000,
  };
  assert.throws(() => createPreparedMigrationJournal({
    ...base,
    randomBytes: () => Buffer.alloc(15),
  }), /entropy/u);
  assert.throws(() => createPreparedMigrationJournal({
    ...base,
    sourceReceipts: {},
    randomBytes: () => Buffer.alloc(16, 1),
  }), /source receipt/u);
  assert.throws(() => createPreparedMigrationJournal({
    ...base,
    gatewayOrigin: 'http://remote.hkust-gz.edu.cn',
    randomBytes: () => Buffer.alloc(16, 1),
  }), /GatewayOrigin/u);
  assert.throws(() => createPreparedMigrationJournal({
    ...base,
    profileId: 'another-school',
    randomBytes: () => Buffer.alloc(16, 1),
  }), /HKUST profile/u);
  assert.throws(() => createPreparedMigrationJournal({
    ...base,
    sourceReceipts: {
      ...sourceReceipts(),
      credentialTransaction: receipt(900),
    },
    randomBytes: () => Buffer.alloc(16, 1),
  }), /precondition source must be absent/u);
});

test('P3 foundation is packaged but does not activate migration in production Main', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  for (const moduleName of [
    'profile-workspace-layout',
    'profile-workspace-migration-journal',
    'profile-workspace-migration-store',
    'profile-workspace-migration-coordinator',
    'profile-workspace-destination-files',
    'legacy-flat-source-retirement',
    'hkust-migration-destination-plan',
    'legacy-credential-rollback-state',
    'legacy-credential-rollback-store',
    'profile-workspace-documents',
    'profile-workspace-runtime-authority',
    'profile-workspace-settings-bundle',
    'profile-workspace-settings-store',
    'profile-workspace-credential-store',
    'profile-workspace-credential-transaction',
    'legacy-migration-inputs',
    'profile-workspace-migration-runtime',
    'legacy-flat-source-receipts',
    'vpn-credential-envelope',
    'vpn-credential-envelope-store',
  ]) {
    assert.equal(main.includes(moduleName), false);
  }
});
