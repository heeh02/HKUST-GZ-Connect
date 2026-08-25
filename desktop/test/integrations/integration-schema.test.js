'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  INTEGRATION_ADAPTER_IDS,
  bindingStateFor,
  createIntegrationAdapterView,
  createIntegrationBinding,
  validateIntegrationBinding,
  validateIntegrationRecord,
  validateIntegrationRecordDocument,
} = require('../../lib/integrations/integration-schema');

const digest = (value) => String(value).repeat(64).slice(0, 64);
const base = Object.freeze({
  adapterId: 'clash_yaml',
  adapterVersion: 1,
  profileId: 'school-a',
  profileRevision: 1,
  profileCredentialBindingRevision: 1,
  accountKey: `account-${'a'.repeat(32)}`,
  accountRevision: 1,
  accountCredentialRevision: 1,
  workspaceKey: `workspace-${'b'.repeat(32)}`,
  activeContextEpoch: 4,
  listenerKind: 'socks5-authenticated',
  loopbackHost: '127.0.0.1',
  loopbackPort: 6180,
  proxySecurityRevision: 3,
  credentialRef: `credential-${'c'.repeat(32)}`,
  networkRulesDigest: digest('1'),
  pacDigest: digest('2'),
  engineGeneration: 7,
  recordRevision: 1,
});

test('internal binding covers every Profile Account listener credential and policy revision', () => {
  const binding = createIntegrationBinding(base);
  assert.deepEqual(validateIntegrationBinding(binding), binding);
  assert.equal(bindingStateFor(null, binding), 'not-installed');
  assert.equal(bindingStateFor(binding, binding), 'current');
  for (const patch of [
    { profileId: 'school-b' },
    { accountCredentialRevision: 2 },
    { activeContextEpoch: 5 },
    { loopbackPort: 6280 },
    { networkRulesDigest: digest('3') },
  ]) {
    assert.equal(bindingStateFor(binding, createIntegrationBinding({ ...base, ...patch })), 'stale');
  }
  assert.equal(bindingStateFor(binding, { malformed: true }), 'unavailable');
});

test('Renderer adapter views are closed key-free and never carry generated payloads or paths', () => {
  for (const adapterId of INTEGRATION_ADAPTER_IDS) {
    const view = createIntegrationAdapterView({
      adapterId, compatibilityState: 'supported', bindingState: 'not-installed',
    });
    assert.equal(view.adapterId, adapterId);
    assert.ok(view.supportedActions.includes('preview'));
    const serialized = JSON.stringify(view);
    for (const forbidden of [
      'accountKey', 'workspaceKey', 'credentialRef', 'targetFile', 'username', 'password',
    ]) assert.equal(serialized.includes(forbidden), false, `${adapterId}: ${forbidden}`);
    assert.equal(Object.hasOwn(view, 'payload'), false);
  }
  assert.throws(() => createIntegrationAdapterView({
    adapterId: 'unknown', compatibilityState: 'supported', bindingState: 'current',
  }), /unsupported/u);
});

test('persistent records retain only non-secret managed ownership and reject duplicate blocks', () => {
  const binding = createIntegrationBinding(base);
  const record = validateIntegrationRecord({
    schemaVersion: 1,
    adapterId: 'clash_yaml',
    adapterVersion: 1,
    profileId: 'school-a',
    bindingDigest: binding.bindingDigest,
    targetFile: '/Users/student/.config/campus-connect/clash.yaml',
    installedRevision: 1,
    installedDigest: digest('4'),
    managedBlockId: 'campus-connect-school-a',
    backupReference: 'backup-0001',
    updatedAt: 1_800_000_000_000,
  });
  assert.equal(JSON.stringify(record).includes('accountKey'), false);
  assert.equal(validateIntegrationRecordDocument({ schemaVersion: 1, records: [record] }).records.length, 1);
  assert.throws(() => validateIntegrationRecordDocument({
    schemaVersion: 1, records: [record, { ...record, targetFile: '/tmp/other' }],
  }), /duplicate ownership/u);
  assert.throws(() => validateIntegrationRecord({ ...record, targetFile: '../relative' }), /absolute/u);
  assert.throws(() => validateIntegrationRecord({ ...record, installedDigest: digest('x') }), /invalid/u);
});
