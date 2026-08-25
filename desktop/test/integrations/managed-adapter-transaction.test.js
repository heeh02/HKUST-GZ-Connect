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

function binding(patch = {}) {
  return createIntegrationBinding({
    adapterId: 'openssh_proxy_command', adapterVersion: 1,
    profileId: 'school-a', profileRevision: 1, profileCredentialBindingRevision: 1,
    accountKey: `account-${'a'.repeat(32)}`, accountRevision: 1,
    accountCredentialRevision: 1, workspaceKey: `workspace-${'b'.repeat(32)}`,
    activeContextEpoch: 1, listenerKind: 'socks5-authenticated',
    loopbackHost: '127.0.0.1', loopbackPort: 6180, proxySecurityRevision: 3,
    credentialRef: `credential-${'c'.repeat(32)}`,
    networkRulesDigest: 'd'.repeat(64), pacDigest: 'e'.repeat(64),
    engineGeneration: null, recordRevision: 1, ...patch,
  });
}

function record(targetFile, managedBlockId, bindingDigest) {
  return {
    schemaVersion: 1,
    adapterId: 'openssh_proxy_command',
    adapterVersion: 1,
    profileId: 'school-a',
    bindingDigest,
    targetFile,
    installedRevision: 1,
    installedDigest: 'f'.repeat(64),
    managedBlockId,
    backupReference: null,
    updatedAt: 1_800_000_000_000,
  };
}

function fixture(t, { recordStoreOverride = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-adapter-'));
  fs.chmodSync(root, 0o700);
  const workspace = path.join(root, 'workspace');
  const targets = path.join(root, 'targets');
  fs.mkdirSync(workspace, { mode: 0o700 });
  fs.mkdirSync(targets, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let entropy = 0;
  const fileTransaction = new ManagedFileTransaction({
    workspaceRoot: workspace,
    backupRoot: path.join(workspace, 'backups'),
    randomBytes: (length) => Buffer.alloc(length, ++entropy),
  });
  const recordStore = recordStoreOverride || new IntegrationRecordStore({
    workspaceRoot: workspace,
    filePath: path.join(workspace, 'external-integrations.json'),
  });
  const owner = new ManagedAdapterTransactionOwner({
    fileTransaction,
    recordStore,
    randomBytes: (length) => Buffer.alloc(length, ++entropy),
    now: () => 1_800_000_000_000,
    ttlMs: 20_000,
  });
  return { root, workspace, targets, fileTransaction, recordStore, owner };
}

function prepared(f) {
  const first = path.join(f.targets, 'config');
  const second = path.join(f.targets, 'school-a.conf');
  fs.writeFileSync(first, 'first-old\n', { mode: 0o600 });
  fs.writeFileSync(second, 'second-old\n', { mode: 0o600 });
  const firstPayload = Buffer.from('first-new\n');
  const secondPayload = Buffer.from('second-new\n');
  const current = binding();
  const records = [
    record(first, 'openssh-include', current.bindingDigest),
    record(second, 'openssh-profile-school-a', current.bindingDigest),
  ];
  return {
    current,
    files: [first, second],
    preview: f.owner.prepare({
      adapterId: 'openssh_proxy_command',
      action: 'install',
      binding: current,
      fileMutations: [
        {
          plan: f.fileTransaction.inspect(first, firstPayload),
          payload: firstPayload,
          validate: () => true,
        },
        {
          plan: f.fileTransaction.inspect(second, secondPayload),
          payload: secondPayload,
          validate: () => true,
        },
      ],
      recordPlan: f.recordStore.planUpserts(records),
      containsLocalProxyCredential: true,
      warningCodes: ['INTEGRATION_LOCAL_CREDENTIAL_PRIVATE'],
    }),
  };
}

test('two managed files and their records commit all-new after one redacted confirmation', (t) => {
  const f = fixture(t);
  const value = prepared(f);
  assert.deepEqual(value.preview.changes, { create: 0, replace: 2, remove: 0, unchanged: 0 });
  const serialized = JSON.stringify(value.preview);
  assert.equal(serialized.includes(f.targets), false);
  assert.equal(serialized.includes('accountKey'), false);
  assert.deepEqual(f.owner.confirm({
    confirmationHandle: value.preview.confirmationHandle,
    currentBinding: value.current,
  }), {
    ok: true,
    adapterId: 'openssh_proxy_command',
    action: 'install',
    cleanupPending: false,
  });
  assert.equal(fs.readFileSync(value.files[0], 'utf8'), 'first-new\n');
  assert.equal(fs.readFileSync(value.files[1], 'utf8'), 'second-new\n');
  assert.equal(f.recordStore.read().records.length, 2);
});

test('record commit failure restores every staged target to all-old', (t) => {
  const real = fixture(t);
  const failing = new ManagedAdapterTransactionOwner({
    fileTransaction: real.fileTransaction,
    recordStore: { apply() { throw new Error('simulated record failure'); } },
    randomBytes: (length) => Buffer.alloc(length, 9),
    now: () => 1_800_000_000_000,
    ttlMs: 20_000,
  });
  real.owner = failing;
  const value = prepared(real);
  assert.throws(() => failing.confirm({
    confirmationHandle: value.preview.confirmationHandle,
    currentBinding: value.current,
  }), { code: 'INTEGRATION_INSTALL_FAILED' });
  assert.equal(fs.readFileSync(value.files[0], 'utf8'), 'first-old\n');
  assert.equal(fs.readFileSync(value.files[1], 'utf8'), 'second-old\n');
});

test('active binding drift and invalid handle perform no file or record mutation', (t) => {
  const f = fixture(t);
  let value = prepared(f);
  assert.throws(() => f.owner.confirm({
    confirmationHandle: value.preview.confirmationHandle,
    currentBinding: binding({ activeContextEpoch: 2 }),
  }), { code: 'INTEGRATION_PROFILE_STALE' });
  assert.equal(fs.readFileSync(value.files[0], 'utf8'), 'first-old\n');
  assert.equal(f.recordStore.read().records.length, 0);

  value = prepared(f);
  assert.throws(() => f.owner.confirm({
    confirmationHandle: 'managed-wrong', currentBinding: value.current,
  }), { code: 'INTEGRATION_TARGET_CHANGED' });
  assert.equal(fs.readFileSync(value.files[1], 'utf8'), 'second-old\n');
});
