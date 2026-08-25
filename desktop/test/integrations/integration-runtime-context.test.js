'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createIntegrationRuntimeContext,
} = require('../../lib/integrations/integration-runtime-context');

const profileDocument = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', '..', 'assets', 'profiles', 'hkustgz', 'school-profile.json'), 'utf8'));
const account = Object.freeze({
  schemaVersion: 1,
  accountKey: `account-${'a'.repeat(32)}`,
  accountRevision: 2,
  accountCredentialRevision: 3,
  role: 'primary',
  state: 'enabled',
  profileId: 'hkustgz',
  profileRevision: 1,
  gatewayOrigin: 'https://remote.hkust-gz.edu.cn',
  protocolFamily: 'easyconnect-password-modern-l3-v1',
  workspaceKey: `workspace-${'b'.repeat(32)}`,
  activeCredentialVersion: 1,
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_100,
});
const workspaceState = Object.freeze({
  schemaVersion: 1,
  profileId: 'hkustgz',
  profileRevision: 1,
  accountKey: account.accountKey,
  accountRevision: account.accountRevision,
  workspaceKey: account.workspaceKey,
  activeContextEpoch: 4,
});
const proxyCredential = Object.freeze({
  reference: () => `credential-${'c'.repeat(32)}`,
  withStrings: (callback) => callback('A'.repeat(32), 'B'.repeat(32)),
});
const settings = Object.freeze({
  port: 6180,
  strictProxyAuth: true,
  proxySecurityVersion: 3,
  routeDomains: ['hkust-gz.edu.cn', 'hkust.edu.hk'],
  customResources: [],
});
const pacSource = "function FindProxyForURL(url, host) { return 'SOCKS5 127.0.0.1:6180'; }";

test('runtime context binds exact Profile Account listener credential rules and PAC without public keys', () => {
  const context = createIntegrationRuntimeContext({
    authority: { account, workspaceState }, profileDocument, settings,
    proxyCredential, pacSource, engineGeneration: null,
  });
  const binding = context.bindingFor('clash_yaml', 2);
  assert.equal(binding.profileId, 'hkustgz');
  assert.equal(binding.accountRevision, 2);
  assert.equal(binding.accountCredentialRevision, 3);
  assert.equal(binding.activeContextEpoch, 4);
  assert.equal(binding.credentialRef, `credential-${'c'.repeat(32)}`);
  assert.equal(binding.networkRulesDigest, context.networkRules.rulesDigest);
  assert.equal(binding.engineGeneration, null, 'durable adapters do not stale on ordinary Engine restart');
});

test('strict auth Profile and authority drift fail before integration payload generation', () => {
  assert.throws(() => createIntegrationRuntimeContext({
    authority: { account, workspaceState }, profileDocument,
    settings: { ...settings, strictProxyAuth: false }, proxyCredential, pacSource,
  }), { code: 'INTEGRATION_AUTH_INCOMPATIBLE' });
  assert.throws(() => createIntegrationRuntimeContext({
    authority: { account: { ...account, profileId: 'other' }, workspaceState },
    profileDocument, settings, proxyCredential, pacSource,
  }));
});
