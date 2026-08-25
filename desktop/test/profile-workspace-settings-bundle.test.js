'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  projectRuntimeSettings,
  splitRuntimeSettings,
} = require('../lib/profile-workspace-settings-bundle');

function authority() {
  return {
    globalSettings: {
      schemaVersion: 1,
      activeProfileKey: `profile-${'11'.repeat(16)}`,
      activeAccountKey: `account-${'22'.repeat(16)}`,
      port: 6180,
      strictProxyAuth: true,
      proxySecurityVersion: 3,
      proxyAuthMigrationPending: false,
      closeAction: 'minimize',
      language: 'zh',
      startAtLogin: false,
    },
    globalUpdateState: { schemaVersion: 1, checkedAt: 1_700_000_000_000 },
    workspaceSettings: {
      schemaVersion: 1,
      autoReconnect: true,
      maxAttempts: 3,
      autoConnect: false,
      routeDomains: ['hkust-gz.edu.cn'],
    },
    localResources: { schemaVersion: 1, resources: [] },
  };
}

function customAuthority() {
  return {
    ...authority(),
    profile: { browser: { campusDomains: [] } },
    workspaceSettings: { ...authority().workspaceSettings, routeDomains: [] },
  };
}

test('runtime settings projection round-trips without persisting the account label', () => {
  const current = projectRuntimeSettings(authority(), { accountLabel: 'synthetic-user' });
  assert.equal(current.username, 'synthetic-user');
  assert.equal(current.port, 6180);
  assert.equal(current.autoConnect, false);
  const split = splitRuntimeSettings(authority(), {
    ...current,
    port: 6280,
    autoConnect: true,
  });
  assert.equal(split.globalSettings.port, 6280);
  assert.equal(split.workspaceSettings.autoConnect, true);
  assert.equal(JSON.stringify(split).includes('synthetic-user'), false);
  assert.equal(Object.isFrozen(split.localResources.resources), true);
  assert.deepEqual(
    split.localResources,
    splitRuntimeSettings({ ...authority(), ...split }, {
      ...current,
      port: 6280,
      autoConnect: true,
    }).localResources,
  );
});

test('runtime settings reject password fields unknown fields and noncanonical values', () => {
  const current = projectRuntimeSettings(authority());
  assert.throws(() => splitRuntimeSettings(authority(), {
    ...current,
    password: 'not-persisted-here',
  }), /schema/u);
  assert.throws(() => splitRuntimeSettings(authority(), { ...current, port: 80 }), /canonical/u);
  assert.throws(() => projectRuntimeSettings(authority(), { accountLabel: 'bad\nlabel' }),
    /控制字符|control/u);
});

test('custom Profile projection and save preserve an explicitly empty campus-domain authority', () => {
  const current = projectRuntimeSettings(customAuthority());
  assert.deepEqual(current.routeDomains, []);
  const split = splitRuntimeSettings(customAuthority(), current);
  assert.deepEqual(split.workspaceSettings.routeDomains, []);
});
