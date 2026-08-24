'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { validateOpaqueKey } = require('./school-profile-schema');

const LEGACY_HKUST_BROWSER_PARTITION = 'persist:hkustgz-campus-browser';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function normalizedUserData(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new TypeError('userData must be an absolute normalized path');
  }
  const normalized = path.resolve(value);
  if (normalized !== value || normalized === path.parse(normalized).root) {
    throw new TypeError('userData must be an absolute normalized path');
  }
  return normalized;
}

function browserPartition(workspaceKey) {
  const digest = crypto.createHash('sha256')
    .update('campus-connect-workspace-partition-v1\0', 'utf8')
    .update(workspaceKey, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `persist:campus-workspace-${digest}`;
}

function createLegacyFlatSourcePaths(userData) {
  const root = normalizedUserData(userData);
  return deepFreeze({
    settings: path.join(root, 'settings.json'),
    settingsBackup: path.join(root, 'settings.json.bak'),
    vpnCredential: path.join(root, 'cred.bin'),
    routingRules: path.join(root, 'routing-rules.json'),
    externalPac: path.join(root, 'routing.pac'),
    browserPac: path.join(root, 'campus-browser-routing.pac'),
    siteCredentials: path.join(root, 'campus-credentials.json'),
    certificateTrust: path.join(root, 'campus-certificate-trust.json'),
    engineLog: path.join(root, 'engine.log'),
  });
}

function createProfileAccountWorkspaceLayout({
  userData,
  profileKey,
  accountKey,
  workspaceKey,
  adoptLegacyHkustBrowserPartition = false,
} = {}) {
  const root = normalizedUserData(userData);
  const keys = {
    profileKey: validateOpaqueKey(profileKey, 'profileKey'),
    accountKey: validateOpaqueKey(accountKey, 'accountKey'),
    workspaceKey: validateOpaqueKey(workspaceKey, 'workspaceKey'),
  };
  if (new Set(Object.values(keys)).size !== 3) {
    throw new TypeError('profile, account and workspace keys must be distinct');
  }
  if (typeof adoptLegacyHkustBrowserPartition !== 'boolean') {
    throw new TypeError('legacy Browser partition adoption must be explicit');
  }

  const globalRoot = path.join(root, 'global');
  const profileRoot = path.join(root, 'profiles', keys.profileKey);
  const accountRoot = path.join(profileRoot, 'accounts', keys.accountKey);
  const workspaceRoot = path.join(accountRoot, 'workspace');
  return deepFreeze({
    root,
    identity: keys,
    global: {
      root: globalRoot,
      settings: path.join(globalRoot, 'settings.json'),
      proxyCredential: path.join(globalRoot, 'proxy-credential.bin'),
      proxyHelperCredential: path.join(globalRoot, 'proxy-helper-credential.txt'),
      engineOwner: path.join(globalRoot, 'engine-owner.json'),
      updateState: path.join(globalRoot, 'update-state.json'),
      activeContextSwitch: path.join(globalRoot, 'active-context-switch.json'),
      migrationJournal: path.join(globalRoot, 'profile-account-workspace-migration.json'),
    },
    profile: {
      root: profileRoot,
      settings: path.join(profileRoot, 'profile-settings.json'),
      state: path.join(profileRoot, 'profile-state.json'),
    },
    account: {
      root: accountRoot,
      document: path.join(accountRoot, 'account.json'),
      vpnCredential: path.join(accountRoot, 'vpn-credential.bin'),
      credentialTransaction: path.join(accountRoot, 'credential-transaction.json'),
      deletionTombstone: path.join(accountRoot, 'deletion-tombstone.json'),
    },
    workspace: {
      root: workspaceRoot,
      state: path.join(workspaceRoot, 'workspace-state.json'),
      siteCredentials: path.join(workspaceRoot, 'campus-credentials.json'),
      certificateTrust: path.join(workspaceRoot, 'campus-certificate-trust.json'),
      routingRules: path.join(workspaceRoot, 'routing-rules.json'),
      externalPac: path.join(workspaceRoot, 'routing.pac'),
      browserPac: path.join(workspaceRoot, 'browser-routing.pac'),
      localResources: path.join(workspaceRoot, 'local-resources.json'),
      favorites: path.join(workspaceRoot, 'favorites.json'),
      recentResources: path.join(workspaceRoot, 'recent-resources.json'),
      externalIntegrations: path.join(workspaceRoot, 'external-integrations.json'),
      engineLog: path.join(workspaceRoot, 'engine.log'),
    },
    browserPartition: adoptLegacyHkustBrowserPartition
      ? LEGACY_HKUST_BROWSER_PARTITION
      : browserPartition(keys.workspaceKey),
  });
}

module.exports = {
  LEGACY_HKUST_BROWSER_PARTITION,
  createLegacyFlatSourcePaths,
  createProfileAccountWorkspaceLayout,
};
