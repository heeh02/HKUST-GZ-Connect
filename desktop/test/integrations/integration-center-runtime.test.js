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

function fixture({ records = [], contextValue = context() } = {}) {
  const calls = [];
  const target = '/Users/student/.ssh/config';
  const fake = (name) => ({
    prepare(value) { calls.push([name, 'prepare', value]); return { confirmationHandle: `${name}-handle` }; },
    prepareInstall(value) { calls.push([name, 'install', value]); return { confirmationHandle: `${name}-handle` }; },
    prepareRemove(value) { calls.push([name, 'remove', value]); return { confirmationHandle: `${name}-handle` }; },
    confirm(value) { calls.push([name, 'confirm', value]); return { ok: true, name }; },
    cancel() { calls.push([name, 'cancel']); return name === 'generic'; },
  });
  const runtime = new IntegrationCenterRuntime({
    getContext: () => contextValue,
    selectTarget: async (value) => { calls.push(['select', value]); return target; },
    ensureSidecar: () => calls.push(['sidecar']),
    recordStore: { read: () => ({ records }) },
    genericCoordinator: fake('generic'),
    clashVergeCoordinator: fake('clash'),
    openSshCoordinator: fake('ssh'),
  });
  return { calls, runtime, target };
}

test('list exposes only closed adapter status and derives current versus stale binding', () => {
  const current = context();
  const binding = current.bindingFor('clash_verge_rev_managed', 1);
  const records = [{
    adapterId: 'clash_verge_rev_managed', profileId: 'school-a',
    managedBlockId: 'clash-verge-rev', bindingDigest: binding.bindingDigest,
    updatedAt: 1_800_000_000_000, targetFile: '/private/Script.js',
  }];
  const f = fixture({ records, contextValue: current });
  const views = f.runtime.list();
  assert.equal(views.find((view) => view.adapterId === 'clash_verge_rev_managed').bindingState,
    'current');
  assert.equal(views.find((view) => view.adapterId === 'vscode_remote_ssh').compatibilityState,
    'unavailable');
  assert.equal(JSON.stringify(views).includes('/private/Script.js'), false);

  const stale = fixture({ records, contextValue: context({ activeContextEpoch: 2 }) });
  assert.equal(stale.runtime.list().find((view) => (
    view.adapterId === 'clash_verge_rev_managed'
  )).bindingState, 'stale');
});

test('generic save selects in Main while managed update reuses its private recorded target', async () => {
  let f = fixture();
  await f.runtime.prepare({ adapterId: 'clash_yaml', action: 'save' });
  assert.ok(f.calls.some(([name]) => name === 'select'));
  assert.equal(f.calls.find(([name, action]) => name === 'generic' && action === 'prepare')[2]
    .targetFile, f.target);

  const binding = context().bindingFor('openssh_proxy_command', 1);
  f = fixture({ records: [{
    adapterId: 'openssh_proxy_command', profileId: 'school-a',
    managedBlockId: 'openssh-profile-school-a', bindingDigest: binding.bindingDigest,
    updatedAt: 1, targetFile: '/Users/student/.ssh/campus-connect/school-a.conf',
  }] });
  await f.runtime.prepare({ adapterId: 'openssh_proxy_command', action: 'update' });
  assert.equal(f.calls.some(([name]) => name === 'select'), false);
  const request = f.calls.find(([name, action]) => name === 'ssh' && action === 'install')[2];
  assert.equal(request.mainConfigFile, '/Users/student/.ssh/config');
});

test('confirm refreshes context, provisions sidecar only for OpenSSH, and cancellation reaches all owners', async () => {
  const f = fixture();
  const preview = await f.runtime.prepare({ adapterId: 'openssh_proxy_command', action: 'install' });
  assert.deepEqual(await f.runtime.confirm({ confirmationHandle: preview.confirmationHandle }), {
    ok: true, name: 'ssh',
  });
  assert.ok(f.calls.some(([name]) => name === 'sidecar'));
  f.runtime.cancel();
  for (const name of ['generic', 'clash', 'ssh']) {
    assert.ok(f.calls.some(([owner, action]) => owner === name && action === 'cancel'));
  }
});

test('disabled runtime is a complete fail-closed facade', async () => {
  const disabled = createDisabledIntegrationCenterRuntime();
  assert.equal(disabled.list().every((view) => view.compatibilityState === 'unavailable'), true);
  await assert.rejects(disabled.prepare({ adapterId: 'clash_yaml', action: 'copy' }), {
    code: 'INTEGRATION_ADAPTER_UNAVAILABLE',
  });
});
