'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateBuiltinResourceDocument } = require('../lib/campus-resource-contract');
const { projectCampusResources } = require('../lib/campus-resources');
const { createControlStateSnapshot } = require('../lib/control-state-snapshot');

function fixture(overrides = {}) {
  const calls = [];
  const snapshot = createControlStateSnapshot({
    getStatus: () => ({ connected: true }),
    loadSettings: () => ({ username: 'student', port: 6180 }),
    hasCredential: () => true,
    getPacUrl: () => 'file:///routing.pac',
    getLocale: () => 'zh-CN',
    platform: 'darwin',
    getVersion: () => '2.0.0-test',
    getUpdate: () => null,
    getResources: () => [{ id: 'home' }, { id: 'hpc' }],
    getFallbackResources: () => [{ id: 'home' }],
    getProfilePresentation: (options) => {
      calls.push(options);
      return {
        schoolProfile: { profileId: 'hkustgz' },
        campusAccount: { kind: 'legacy-primary', hasCredential: options.hasCredential === true },
        workspace: { kind: 'legacy-workspace', resourceCount: options.resourceCount ?? 1 },
      };
    },
    getAuthChallenge: () => null,
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
  assert.deepEqual(value.campusResources.map(({ id }) => id), ['home', 'hpc']);
  assert.deepEqual(calls, [{ locale: 'zh-CN', hasCredential: true, resourceCount: 2 }]);
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
  assert.deepEqual(value.campusResources, [{ id: 'home' }]);
  assert.equal(credentialReads, 0);
  assert.deepEqual(calls, [{ locale: 'zh-CN' }]);
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
