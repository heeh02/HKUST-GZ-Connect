'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ACTIVE_INTEGRATION_ADAPTER_IDS,
  INTEGRATION_ADAPTER_IDS,
  bindingStateFor,
  createIntegrationAdapterView,
  createIntegrationBinding,
  validateIntegrationBinding,
} = require('../../lib/integrations/integration-schema');

const digest = (value) => String(value).repeat(64).slice(0, 64);
const base = Object.freeze({
  adapterId: 'clash_mihomo_yaml',
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
  const optional = createIntegrationBinding({
    ...base,
    listenerKind: 'socks5-optional-authentication',
  });
  assert.equal(optional.listenerKind, 'socks5-optional-authentication');
  assert.equal(bindingStateFor(binding, optional), 'stale');
});

test('Renderer adapter views are closed key-free and never carry generated payloads or paths', () => {
  assert.deepEqual(ACTIVE_INTEGRATION_ADAPTER_IDS, [
    'clash_mihomo_yaml', 'vscode_remote_ssh',
  ]);
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
