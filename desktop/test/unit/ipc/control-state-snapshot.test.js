'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateBuiltinResourceDocument } = require('../../../lib/resources/schema/campus-resource-contract');
const { projectCampusResources } = require('../../../lib/resources/runtime/campus-resources');
const { createControlStateSnapshot } = require('../../../lib/ipc/control-state-snapshot');

function fixture(overrides = {}) {
  const calls = [];
  const snapshot = createControlStateSnapshot({
    getStatus: () => ({ connected: true }),
    loadSettings: () => ({ username: 'student', port: 6180 }),
    hasCredential: () => true,
    hasAccountIdentity: (settings) => Boolean(settings.username),
    getPacUrl: () => 'file:///routing.pac',
    getLocale: () => 'zh-CN',
    platform: 'darwin',
    getVersion: () => '2.0.0-test',
    getUpdate: () => null,
    getResources: () => [
      { id: 'home', favorite: true, lastOpenedAt: 20 },
      { id: 'hpc', favorite: false, lastOpenedAt: null },
    ],
    getFallbackResources: () => [{ id: 'home', favorite: false, lastOpenedAt: null }],
    getProfilePresentation: (options) => {
      calls.push(options);
      return {
        schoolProfile: { profileId: 'hkustgz' },
        campusAccount: { kind: 'legacy-primary', hasCredential: options.hasCredential === true },
        workspace: { kind: 'legacy-workspace', resourceCount: options.resourceCount ?? 1 },
      };
    },
    getAuthChallenge: () => null,
    getCapabilitySnapshot: () => null,
    ...overrides,
  });
  return { calls, snapshot };
}

test('projects settings, resources and key-free profile compatibility views', () => {
  const { calls, snapshot } = fixture();
  const value = snapshot();
  assert.equal(value.connected, true);
  assert.equal(value.loggedIn, true);
  assert.equal(value.hasPassword, true);
  assert.equal(value.capabilitySnapshot, null);
  assert.deepEqual(value.campusResources.map(({ id }) => id), ['home', 'hpc']);
  assert.deepEqual(calls, [{
    locale: 'zh-CN',
    hasCredential: true,
    resourceCount: 2,
    favoriteCount: 1,
    recentCount: 1,
  }]);
  for (const forbidden of ['engineConfigRef', 'reviewedDnsFallback', 'accountKey', 'workspaceKey']) {
    assert.equal(JSON.stringify(value).includes(forbidden), false);
  }
});

test('settings failure returns the bounded fallback without probing credentials', () => {
  let credentialReads = 0;
  const { calls, snapshot } = fixture({
    loadSettings: () => { throw new Error('corrupt settings'); },
    hasCredential: () => { credentialReads += 1; return true; },
  });
  const value = snapshot();
  assert.equal(value.settings, null);
  assert.equal(value.loggedIn, false);
  assert.equal(value.hasPassword, false);
  assert.deepEqual(value.campusResources, [{ id: 'home', favorite: false, lastOpenedAt: null }]);
  assert.equal(credentialReads, 0);
  assert.deepEqual(calls, [{ locale: 'zh-CN' }]);
});

test('get-state carries only the already-sanitized additive capability snapshot', () => {
  const capabilitySnapshot = Object.freeze({
    schemaVersion: 1,
    profileId: 'hkustgz',
    profileRevision: 1,
    accountHandle: 'ephemeral-account-handle',
    activeContextEpoch: 1,
    engineGeneration: 7,
    layers: {},
    effective: { 'auth.password': 'supported', 'transport.l3': 'supported' },
  });
  const { snapshot } = fixture({ getCapabilitySnapshot: () => capabilitySnapshot });
  assert.equal(snapshot().capabilitySnapshot, capabilitySnapshot);
  assert.equal(JSON.stringify(snapshot()).includes('accountKey'), false);
});

test('persistent Account identity can stay logged in without a plaintext settings username', () => {
  const { snapshot } = fixture({
    loadSettings: () => ({ username: '', port: 6180 }),
    hasAccountIdentity: () => true,
  });
  assert.equal(snapshot().loggedIn, true);
  assert.equal(snapshot().settings.username, '');
});

test('legacy custom URL conflicts cannot make get-state fail', () => {
  const builtins = validateBuiltinResourceDocument([{
    id: 'home',
    name: 'Home',
    description: '',
    url: 'https://www.example.edu/',
    route: 'campus',
  }]);
  const customResources = [{
    id: 'legacy-duplicate',
    name: 'Legacy duplicate',
    description: '',
    url: 'https://www.example.edu/',
    route: 'campus',
  }];
  const { snapshot } = fixture({
    loadSettings: () => ({ username: 'student', port: 6180, customResources }),
    getResources: (settings) => projectCampusResources(
      builtins, settings.customResources,
    ).resources,
  });
  assert.deepEqual(snapshot().campusResources.map(({ id }) => id), ['home']);
  assert.equal(customResources.length, 1, 'the compatibility view must not rewrite settings');
});

test('rejects an incomplete composition at construction time', () => {
  assert.throws(() => createControlStateSnapshot(), /getStatus must be a function/u);
  assert.throws(() => createControlStateSnapshot({ getStatus() {} }), /loadSettings/u);
});
