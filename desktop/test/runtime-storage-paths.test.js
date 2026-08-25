'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createProfileAccountWorkspaceLayout } = require('../lib/profile-workspace-layout');
const {
  RUNTIME_PATH_KEYS,
  createLegacyRuntimeStoragePaths,
  createProfileWorkspaceRuntimeStoragePaths,
} = require('../lib/runtime-storage-paths');

const USER_DATA = path.resolve('/tmp/campus-runtime-storage');

test('legacy path seam is an exact behavior-preserving projection', () => {
  const paths = createLegacyRuntimeStoragePaths(USER_DATA);
  assert.equal(paths.mode, 'legacy-flat');
  assert.equal(paths.settings, path.join(USER_DATA, 'settings.json'));
  assert.equal(paths.settingsBackup, path.join(USER_DATA, 'settings.json.bak'));
  assert.equal(paths.vpnCredential, path.join(USER_DATA, 'cred.bin'));
  assert.equal(paths.externalPac, path.join(USER_DATA, 'routing.pac'));
  assert.equal(paths.browserPac, path.join(USER_DATA, 'campus-browser-routing.pac'));
  assert.equal(paths.activeContextSwitch, path.join(USER_DATA, 'active-context-switch.json'));
  assert.deepEqual(
    Object.keys(paths).filter((key) => !['mode', 'root'].includes(key)),
    [...RUNTIME_PATH_KEYS],
  );
  assert.equal(Object.isFrozen(paths), true);
});

test('Profile Workspace path seam assigns every service to its owner scope', () => {
  const layout = createProfileAccountWorkspaceLayout({
    userData: USER_DATA,
    profileKey: `profile-${'11'.repeat(16)}`,
    accountKey: `account-${'22'.repeat(16)}`,
    workspaceKey: `workspace-${'33'.repeat(16)}`,
  });
  const paths = createProfileWorkspaceRuntimeStoragePaths({ layout });
  assert.equal(paths.mode, 'profile-workspace');
  assert.equal(paths.vpnCredential, layout.account.vpnCredential);
  assert.equal(paths.engineOwner, layout.global.engineOwner);
  assert.equal(paths.proxyCredential, layout.account.proxyCredential);
  assert.equal(paths.proxyHelperCredential, layout.account.proxyHelperCredential);
  assert.equal(paths.routingRules, layout.workspace.routingRules);
  assert.equal(paths.siteCredentials, layout.workspace.siteCredentials);
  assert.equal(paths.settingsBackup, layout.global.settingsTransaction);
  assert.equal(paths.activeContextSwitch, layout.global.activeContextSwitch);
  for (const sensitive of ['student001', 'remote.hkust-gz.edu.cn']) {
    assert.equal(JSON.stringify(paths).includes(sensitive), false);
  }
});

test('path seam rejects missing duplicate and escaping runtime targets', () => {
  assert.throws(() => createLegacyRuntimeStoragePaths('relative'), /userData/u);
  const layout = createProfileAccountWorkspaceLayout({
    userData: USER_DATA,
    profileKey: `profile-${'11'.repeat(16)}`,
    accountKey: `account-${'22'.repeat(16)}`,
    workspaceKey: `workspace-${'33'.repeat(16)}`,
  });
  assert.throws(() => createProfileWorkspaceRuntimeStoragePaths({
    layout: {
      ...layout,
      global: { ...layout.global, settingsTransaction: layout.global.settings },
    },
  }), /incomplete/u);
});

test('production Main obtains all legacy paths through the seam', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.equal(main.includes('createLegacyRuntimeStoragePaths(DATA)'), true);
  assert.equal(main.includes("path.join(DATA, 'settings.json')"), false);
  assert.equal(main.includes("path.join(DATA, 'cred.bin')"), false);
});
