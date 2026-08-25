'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
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
  OpenSshManagedCoordinator,
} = require('../../lib/integrations/openssh-managed-coordinator');
const {
  createProfileNetworkRules,
} = require('../../lib/integrations/profile-network-rules');

const reviewed = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', '..', 'assets', 'profiles', 'hkustgz', 'school-profile.json'), 'utf8'));
const networkRules = createProfileNetworkRules({ profileDocument: reviewed });

function context(patch = {}) {
  const value = { port: 6180, networkRules, ...patch };
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

function fixture(t, { preexistingInclude = false, emptyMain = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openssh-managed-'));
  fs.chmodSync(root, 0o700);
  const workspace = path.join(root, 'workspace');
  const ssh = path.join(root, '.ssh');
  fs.mkdirSync(workspace, { mode: 0o700 });
  fs.mkdirSync(ssh, { mode: 0o700 });
  const mainConfigFile = path.join(ssh, 'config');
  const original = emptyMain
    ? ''
    : `Host github.com\n    User git\n${preexistingInclude ? 'Include ~/.ssh/campus-connect/*.conf\n' : ''}`;
  if (!emptyMain) fs.writeFileSync(mainConfigFile, original, { mode: 0o600 });
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
    ssh, mainConfigFile, original, recordStore,
    coordinator: new OpenSshManagedCoordinator({
      fileTransaction, recordStore, transactionOwner,
      helperPath: '/Applications/Campus Connect.app/helper',
      credentialFile: path.join(workspace, 'proxy-helper-credential.txt'),
      now: () => 1_800_000_000_000,
    }),
  };
}

test('install and remove commit main Include plus Profile config as one record transaction', (t) => {
  const f = fixture(t);
  const current = context();
  const preview = f.coordinator.prepareInstall({
    context: current, mainConfigFile: f.mainConfigFile,
  });
  assert.deepEqual(preview.changes, { create: 1, replace: 1, remove: 0, unchanged: 0 });
  assert.equal(JSON.stringify(preview).includes(f.mainConfigFile), false);
  f.coordinator.confirm({ confirmationHandle: preview.confirmationHandle, context: current });
  const profileFile = path.join(f.ssh, 'campus-connect', 'hkustgz.conf');
  assert.match(fs.readFileSync(f.mainConfigFile, 'utf8'), /Include ~\/\.ssh\/campus-connect\/\*\.conf/u);
  assert.match(fs.readFileSync(profileFile, 'utf8'), /--profile-id "hkustgz"/u);
  assert.equal(f.recordStore.read().records.length, 2);

  const removal = f.coordinator.prepareRemove({ context: current });
  f.coordinator.confirm({ confirmationHandle: removal.confirmationHandle, context: current });
  assert.equal(fs.readFileSync(f.mainConfigFile, 'utf8'), f.original);
  assert.equal(fs.existsSync(profileFile), false);
  assert.equal(fs.existsSync(path.dirname(profileFile)), false);
  assert.equal(f.recordStore.read().records.length, 0);
});

test('a preexisting unowned Include is retained and never receives an ownership record', (t) => {
  const f = fixture(t, { preexistingInclude: true });
  const current = context();
  let preview = f.coordinator.prepareInstall({ context: current, mainConfigFile: f.mainConfigFile });
  assert.equal(preview.changes.unchanged, 1);
  f.coordinator.confirm({ confirmationHandle: preview.confirmationHandle, context: current });
  assert.deepEqual(f.recordStore.read().records.map((record) => record.managedBlockId), [
    'openssh-profile-hkustgz',
  ]);
  preview = f.coordinator.prepareRemove({ context: current });
  f.coordinator.confirm({ confirmationHandle: preview.confirmationHandle, context: current });
  assert.equal(fs.readFileSync(f.mainConfigFile, 'utf8'), f.original);
});

test('unrelated edits survive removal while owned block tampering fails closed', (t) => {
  const f = fixture(t);
  const current = context();
  let preview = f.coordinator.prepareInstall({ context: current, mainConfigFile: f.mainConfigFile });
  f.coordinator.confirm({ confirmationHandle: preview.confirmationHandle, context: current });
  const profileFile = path.join(f.ssh, 'campus-connect', 'hkustgz.conf');
  fs.appendFileSync(f.mainConfigFile, 'Host user-added\n    User student\n');
  fs.appendFileSync(profileFile, '# user note\n');
  preview = f.coordinator.prepareRemove({ context: current });
  f.coordinator.confirm({ confirmationHandle: preview.confirmationHandle, context: current });
  assert.match(fs.readFileSync(f.mainConfigFile, 'utf8'), /Host user-added/u);
  assert.equal(fs.readFileSync(profileFile, 'utf8'), '# user note\n');

  const second = fixture(t);
  preview = second.coordinator.prepareInstall({ context: current, mainConfigFile: second.mainConfigFile });
  second.coordinator.confirm({ confirmationHandle: preview.confirmationHandle, context: current });
  const secondProfile = path.join(second.ssh, 'campus-connect', 'hkustgz.conf');
  fs.writeFileSync(secondProfile,
    fs.readFileSync(secondProfile, 'utf8').replace('ProxyCommand', 'TamperedCommand'),
    { mode: 0o600 });
  assert.throws(() => second.coordinator.prepareRemove({ context: current }), {
    code: 'INTEGRATION_TARGET_CHANGED',
  });
});

test('missing main config is created on install and removed only when wholly app-owned', (t) => {
  const f = fixture(t, { emptyMain: true });
  const current = context();
  let preview = f.coordinator.prepareInstall({ context: current, mainConfigFile: f.mainConfigFile });
  assert.equal(preview.changes.create, 2);
  f.coordinator.confirm({ confirmationHandle: preview.confirmationHandle, context: current });
  preview = f.coordinator.prepareRemove({ context: current });
  f.coordinator.confirm({ confirmationHandle: preview.confirmationHandle, context: current });
  assert.equal(fs.existsSync(f.mainConfigFile), false);
});
