'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  validateGlobalSettingsDocument,
  validateGlobalUpdateStateDocument,
  validateProfileSettingsDocument,
  validateProfileStateDocument,
  validateWorkspaceSettingsDocument,
} = require('../../../../lib/persistence/schema/profile-workspace-documents');

const PROFILE_KEY = `profile-${'11'.repeat(16)}`;
const ACCOUNT_KEY = `account-${'22'.repeat(16)}`;

test('runtime storage documents are exact canonical and immutable', () => {
  const global = validateGlobalSettingsDocument({
    schemaVersion: 1,
    activeProfileKey: PROFILE_KEY,
    activeAccountKey: ACCOUNT_KEY,
    port: 6180,
    strictProxyAuth: true,
    proxySecurityVersion: 3,
    proxyAuthMigrationPending: false,
    closeAction: 'minimize',
    language: 'en',
    startAtLogin: true,
  });
  const update = validateGlobalUpdateStateDocument({ schemaVersion: 1, checkedAt: 0 });
  const profile = validateProfileSettingsDocument({
    schemaVersion: 1,
    profileId: 'hkustgz',
    profileRevision: 1,
    primaryAccountKey: ACCOUNT_KEY,
  });
  const state = validateProfileStateDocument({
    schemaVersion: 1,
    migrationId: `migration-${'33'.repeat(16)}`,
    profileId: 'hkustgz',
    profileRevision: 1,
    profileCredentialBindingRevision: 1,
    gatewayOrigin: 'https://remote.hkust-gz.edu.cn',
    protocolFamily: 'easyconnect-password-modern-l3-v1',
  });
  const workspace = validateWorkspaceSettingsDocument({
    schemaVersion: 1,
    autoReconnect: true,
    maxAttempts: 3,
    autoConnect: false,
    routeDomains: ['hkust-gz.edu.cn', 'hkust.edu.hk'],
  });
  for (const document of [global, update, profile, state, workspace]) {
    assert.equal(Object.isFrozen(document), true);
  }
  assert.equal(Object.isFrozen(workspace.routeDomains), true);
  assert.equal(state.gatewayOrigin, 'https://remote.hkust-gz.edu.cn');
  assert.deepEqual(validateWorkspaceSettingsDocument({
    schemaVersion: 1,
    autoReconnect: true,
    maxAttempts: 3,
    autoConnect: false,
    routeDomains: [],
  }).routeDomains, [], 'an unreviewed custom Profile starts without invented campus domains');
});

test('runtime storage documents reject drift instead of normalizing it silently', () => {
  const global = {
    schemaVersion: 1,
    activeProfileKey: PROFILE_KEY,
    activeAccountKey: ACCOUNT_KEY,
    port: 6180,
    strictProxyAuth: false,
    proxySecurityVersion: 3,
    proxyAuthMigrationPending: true,
    closeAction: 'ask',
    language: 'auto',
    startAtLogin: false,
  };
  assert.throws(() => validateGlobalSettingsDocument({ ...global, extra: true }), /schema/u);
  assert.throws(() => validateGlobalSettingsDocument({
    ...global,
    strictProxyAuth: true,
  }), /pending/u);
  assert.throws(() => validateGlobalUpdateStateDocument({
    schemaVersion: 1,
    checkedAt: -1,
  }), /timestamp/u);
  assert.throws(() => validateWorkspaceSettingsDocument({
    schemaVersion: 1,
    autoReconnect: true,
    maxAttempts: 3,
    autoConnect: true,
    routeDomains: ['*.HKUST-GZ.EDU.CN'],
  }), /canonical/u);
});
