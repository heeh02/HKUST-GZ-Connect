'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  ClashVergeManagedCoordinator,
} = require('../../lib/integrations/clash-verge-managed-coordinator');
const {
  IntegrationRecordStore,
} = require('../../lib/integrations/integration-record-store');
const {
  createIntegrationBinding,
} = require('../../lib/integrations/integration-schema');
const {
  ManagedAdapterTransactionOwner,
} = require('../../lib/integrations/managed-adapter-transaction');
const {
  ManagedFileTransaction,
} = require('../../lib/integrations/managed-file-transaction');
const {
  createProfileNetworkRules,
} = require('../../lib/integrations/profile-network-rules');

const reviewed = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', '..', 'assets', 'profiles', 'hkustgz', 'school-profile.json'), 'utf8'));
const networkRules = createProfileNetworkRules({ profileDocument: reviewed });
const credential = {
  withStrings(callback) { return callback('A'.repeat(32), 'B'.repeat(32)); },
};

function context(patch = {}) {
  const value = {
    port: 6180,
    credential,
    networkRules,
    ...patch,
  };
  return Object.freeze({
    ...value,
    bindingFor(adapterId, recordRevision) {
      return createIntegrationBinding({
        adapterId, adapterVersion: 1, profileId: value.networkRules.profileId,
        profileRevision: value.networkRules.profileRevision,
        profileCredentialBindingRevision: value.networkRules.profileCredentialBindingRevision,
        accountKey: `account-${'a'.repeat(32)}`, accountRevision: 1,
        accountCredentialRevision: 1, workspaceKey: `workspace-${'b'.repeat(32)}`,
        activeContextEpoch: 1, listenerKind: 'socks5-authenticated',
        loopbackHost: '127.0.0.1', loopbackPort: value.port, proxySecurityRevision: 3,
        credentialRef: `credential-${'c'.repeat(32)}`,
        networkRulesDigest: value.networkRules.rulesDigest, pacDigest: 'd'.repeat(64),
        engineGeneration: null, recordRevision,
      });
    },
  });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-verge-managed-'));
  fs.chmodSync(root, 0o700);
  const workspace = path.join(root, 'workspace');
  const profiles = path.join(root, 'profiles');
  fs.mkdirSync(workspace, { mode: 0o700 });
  fs.mkdirSync(profiles, { mode: 0o700 });
  const targetFile = path.join(profiles, 'Script.js');
  const original = 'function main(config) { config.existing = true; return config; }\n';
  fs.writeFileSync(targetFile, original, { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let entropy = 0;
  const fileTransaction = new ManagedFileTransaction({
    workspaceRoot: workspace,
    backupRoot: path.join(workspace, 'backups'),
    randomBytes: (length) => Buffer.alloc(length, ++entropy),
  });
  const recordStore = new IntegrationRecordStore({
    workspaceRoot: workspace,
    filePath: path.join(workspace, 'external-integrations.json'),
  });
  const transactionOwner = new ManagedAdapterTransactionOwner({
    fileTransaction, recordStore,
    randomBytes: (length) => Buffer.alloc(length, ++entropy),
    now: () => 1_800_000_000_000,
    ttlMs: 20_000,
  });
  return {
    targetFile, original, recordStore,
    coordinator: new ClashVergeManagedCoordinator({
      fileTransaction, recordStore, transactionOwner,
      now: () => 1_800_000_000_000,
    }),
  };
}

test('install and remove transact one exact Script.js block and non-secret record', (t) => {
  const f = fixture(t);
  const current = context();
  const preview = f.coordinator.prepareInstall({ context: current, targetFile: f.targetFile });
  assert.equal(preview.action, 'install');
  assert.equal(preview.containsLocalProxyCredential, true);
  assert.equal(JSON.stringify(preview).includes(f.targetFile), false);
  f.coordinator.confirm({ confirmationHandle: preview.confirmationHandle, context: current });
  const installed = fs.readFileSync(f.targetFile, 'utf8');
  const sandbox = vm.createContext({});
  new vm.Script(installed).runInContext(sandbox);
  const effective = sandbox.main({ proxies: [], rules: [] }, 'test');
  assert.equal(effective.proxies[0].name, 'Campus Connect - hkustgz');
  assert.equal(f.recordStore.read().records.length, 1);

  fs.appendFileSync(f.targetFile, '// unrelated user edit\n');
  const removal = f.coordinator.prepareRemove({ context: current });
  f.coordinator.confirm({ confirmationHandle: removal.confirmationHandle, context: current });
  const removed = fs.readFileSync(f.targetFile, 'utf8');
  assert.doesNotMatch(removed, /CAMPUS-CONNECT MANAGED/u);
  assert.match(removed, /unrelated user edit/u);
  assert.equal(f.recordStore.read().records.length, 0);
});

test('update replaces only the active block and tampering blocks removal', (t) => {
  const f = fixture(t);
  const current = context();
  let preview = f.coordinator.prepareInstall({ context: current, targetFile: f.targetFile });
  f.coordinator.confirm({ confirmationHandle: preview.confirmationHandle, context: current });
  const changedRules = createProfileNetworkRules({
    profileDocument: reviewed,
    accountCampusDomains: ['new.internal.example'],
  });
  const changed = context({ port: 6280, networkRules: changedRules });
  preview = f.coordinator.prepareInstall({ context: changed, targetFile: f.targetFile });
  assert.equal(preview.action, 'update');
  f.coordinator.confirm({ confirmationHandle: preview.confirmationHandle, context: changed });
  assert.match(fs.readFileSync(f.targetFile, 'utf8'), /"port":6280/u);
  assert.equal(f.recordStore.read().records[0].installedRevision, 2);

  const source = fs.readFileSync(f.targetFile, 'utf8').replace('managedProxy', 'tamperedProxy');
  fs.writeFileSync(f.targetFile, source, { mode: 0o600 });
  assert.throws(() => f.coordinator.prepareRemove({ context: changed }), {
    code: 'INTEGRATION_TARGET_CHANGED',
  });
});
