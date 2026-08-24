'use strict';

const path = require('node:path');
const {
  createLegacyFlatSourcePaths,
  validateUserDataRoot,
} = require('./profile-workspace-layout');

const RUNTIME_PATH_KEYS = Object.freeze([
  'settings',
  'settingsBackup',
  'vpnCredential',
  'engineLog',
  'engineLogRotated',
  'engineLogRetention',
  'externalPac',
  'browserPac',
  'routingRules',
  'siteCredentials',
  'certificateTrust',
  'engineOwner',
  'credentialTransaction',
  'activeContextSwitch',
  'proxyCredential',
  'proxyHelperCredential',
]);

function finalize(mode, root, values) {
  if (!['legacy-flat', 'profile-workspace'].includes(mode) ||
      Object.keys(values).length !== RUNTIME_PATH_KEYS.length ||
      RUNTIME_PATH_KEYS.some((key) => typeof values[key] !== 'string') ||
      new Set(Object.values(values)).size !== RUNTIME_PATH_KEYS.length) {
    throw new TypeError('runtime storage path set is incomplete');
  }
  for (const file of Object.values(values)) {
    if (!path.isAbsolute(file) || path.resolve(file) !== file) {
      throw new TypeError('runtime storage path must be absolute and normalized');
    }
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
      throw new TypeError('runtime storage path escapes userData');
    }
  }
  return Object.freeze({ mode, root, ...values });
}

function createLegacyRuntimeStoragePaths(userData) {
  const root = validateUserDataRoot(userData);
  const legacy = createLegacyFlatSourcePaths(root);
  return finalize('legacy-flat', root, {
    settings: legacy.settings,
    settingsBackup: legacy.settingsBackup,
    vpnCredential: legacy.vpnCredential,
    engineLog: legacy.engineLog,
    engineLogRotated: legacy.engineLogRotated,
    engineLogRetention: legacy.engineLogRetention,
    externalPac: legacy.externalPac,
    browserPac: legacy.browserPac,
    routingRules: legacy.routingRules,
    siteCredentials: legacy.siteCredentials,
    certificateTrust: legacy.certificateTrust,
    engineOwner: legacy.engineOwner,
    credentialTransaction: legacy.credentialTransaction,
    activeContextSwitch: legacy.activeContextSwitch,
    proxyCredential: legacy.proxyCredential,
    proxyHelperCredential: legacy.proxyHelperCredential,
  });
}

function createProfileWorkspaceRuntimeStoragePaths(authority) {
  const layout = authority?.layout;
  const root = validateUserDataRoot(layout?.root);
  return finalize('profile-workspace', root, {
    // Split settings are accessed through ProfileWorkspaceSettingsStore. This
    // field is its global bootstrap authority, not a legacy-compatible file.
    settings: layout.global.settings,
    settingsBackup: layout.global.settingsTransaction,
    vpnCredential: layout.account.vpnCredential,
    engineLog: layout.workspace.engineLog,
    engineLogRotated: layout.workspace.engineLogRotated,
    engineLogRetention: layout.workspace.engineLogRetention,
    externalPac: layout.workspace.externalPac,
    browserPac: layout.workspace.browserPac,
    routingRules: layout.workspace.routingRules,
    siteCredentials: layout.workspace.siteCredentials,
    certificateTrust: layout.workspace.certificateTrust,
    engineOwner: layout.global.engineOwner,
    credentialTransaction: layout.account.credentialTransaction,
    activeContextSwitch: layout.global.activeContextSwitch,
    proxyCredential: layout.global.proxyCredential,
    proxyHelperCredential: layout.global.proxyHelperCredential,
  });
}

module.exports = {
  RUNTIME_PATH_KEYS,
  createLegacyRuntimeStoragePaths,
  createProfileWorkspaceRuntimeStoragePaths,
};
