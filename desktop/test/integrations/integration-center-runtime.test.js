'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  IntegrationCenterRuntime,
  createDisabledIntegrationCenterRuntime,
} = require('../../lib/integrations/integration-center-runtime');
const {
  createIntegrationBinding,
} = require('../../lib/integrations/integration-schema');

function context(patch = {}) {
  const profileId = patch.profileId || 'school-a';
  return {
    networkRules: { profileId },
    port: 6180,
    credential: {},
    pacSource: 'function FindProxyForURL() { return "DIRECT"; }',
    bindingFor(adapterId, recordRevision) {
      return createIntegrationBinding({
        adapterId, adapterVersion: 1, profileId, profileRevision: 1,
        profileCredentialBindingRevision: 1,
        accountKey: `account-${'a'.repeat(32)}`, accountRevision: 1,
        accountCredentialRevision: 1, workspaceKey: `workspace-${'b'.repeat(32)}`,
        activeContextEpoch: patch.activeContextEpoch || 1,
        listenerKind: 'socks5-authenticated', loopbackHost: '127.0.0.1',
        loopbackPort: 6180, proxySecurityRevision: 3,
        credentialRef: `credential-${'c'.repeat(32)}`,
        networkRulesDigest: 'd'.repeat(64), pacDigest: 'e'.repeat(64),
        engineGeneration: null, recordRevision,
      });
    },
  };
}

function fixture({ contextValue = context() } = {}) {
  const calls = [];
  const target = '/Users/student/.ssh/config';
  const fake = (name) => ({
    prepare(value) { calls.push([name, 'prepare', value]); return { confirmationHandle: `${name}-handle` }; },
    confirm(value) { calls.push([name, 'confirm', value]); return { ok: true, name }; },
    cancel() { calls.push([name, 'cancel']); return name === 'generic'; },
  });
  const runtime = new IntegrationCenterRuntime({
    getContext: () => contextValue,
    selectTarget: async (value) => { calls.push(['select', value]); return target; },
    ensureSidecar: () => calls.push(['sidecar']),
    genericCoordinator: fake('generic'),
    helperPath: '/Applications/Campus Connect.app/Contents/Resources/ec-proxy-command',
    credentialFile: '/Users/student/Library/Application Support/Campus Connect/proxy-credential',
  });
  return { calls, runtime, target };
}

test('list exposes only the three non-destructive configuration exports', () => {
  const f = fixture();
  const views = f.runtime.list();
  assert.deepEqual(views.map((view) => view.adapterId), [
    'clash_yaml', 'mihomo_yaml', 'vscode_remote_ssh',
  ]);
  assert.equal(views.every((view) => view.compatibilityState === 'supported'), true);
  assert.equal(views.every((view) => view.bindingState === 'not-installed'), true);
});

test('Clash save selects a destination while VS Code remains copy-only', async () => {
  const f = fixture();
  await f.runtime.prepare({ adapterId: 'clash_yaml', action: 'save' });
  assert.ok(f.calls.some(([name]) => name === 'select'));
  assert.equal(f.calls.find(([name, action]) => name === 'generic' && action === 'prepare')[2]
    .targetFile, f.target);

  assert.equal((await f.runtime.prepare({
    adapterId: 'vscode_remote_ssh', action: 'copy',
  })).confirmationHandle, 'generic-handle');
  await assert.rejects(f.runtime.prepare({
    adapterId: 'vscode_remote_ssh', action: 'save',
  }), { code: 'INTEGRATION_ADAPTER_UNAVAILABLE' });
});

test('confirm refreshes context and provisions a sidecar only for the VS Code snippet', async () => {
  const f = fixture();
  const preview = await f.runtime.prepare({ adapterId: 'vscode_remote_ssh', action: 'copy' });
  assert.deepEqual(await f.runtime.confirm({ confirmationHandle: preview.confirmationHandle }), {
    ok: true, name: 'generic',
  });
  assert.ok(f.calls.some(([name]) => name === 'sidecar'));
  f.runtime.cancel();
  assert.ok(f.calls.some(([owner, action]) => owner === 'generic' && action === 'cancel'));
});

test('disabled runtime is a complete fail-closed facade', async () => {
  const disabled = createDisabledIntegrationCenterRuntime();
  assert.equal(disabled.list().every((view) => view.compatibilityState === 'unavailable'), true);
  await assert.rejects(disabled.prepare({ adapterId: 'clash_yaml', action: 'copy' }), {
    code: 'INTEGRATION_ADAPTER_UNAVAILABLE',
  });
});
