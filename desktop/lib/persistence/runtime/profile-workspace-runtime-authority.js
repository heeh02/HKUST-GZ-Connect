'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { collectPrivateFileReceipt } = require('../../legacy-flat-source-receipts');
const { readPrivateFileBounded } = require('../../private-file');
const {
  createProfileAccountBootstrapLayout,
  createProfileAccountWorkspaceLayout,
  validateUserDataRoot,
} = require('../paths/profile-workspace-layout');
const {
  validateGlobalSettingsDocument,
  validateGlobalUpdateStateDocument,
  validateLocalResourcesDocument,
  validateProfileSettingsDocument,
  validateProfileStateDocument,
  validateWorkspaceSettingsDocument,
} = require('../schema/profile-workspace-documents');
const {
  validateCampusAccountDocument,
  validateSchoolProfileDocument,
  validateWorkspaceScopeDocument,
} = require('../../profiles/schema/school-profile-schema');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('../../windows-private-file');

const MAX_RUNTIME_DOCUMENT_BYTES = 512 * 1024;
const MAX_RUNTIME_CREDENTIAL_BYTES = 64 * 1024;

function equal(left, right, name) {
  if (left !== right) throw new Error(`active workspace ${name} binding does not match`);
}

function directoryChain(root, directory, { fileSystem, platform }) {
  const relative = path.relative(root, directory);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('active workspace directory escapes userData');
  }
  let current = root;
  for (const component of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    let stat;
    try {
      stat = fileSystem.lstatSync(current);
    } catch (error) {
      throw new Error('active workspace directory is unavailable', { cause: error });
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        (platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
      throw new Error('active workspace directory is not owner-only and link-free');
    }
  }
}

function readDocument(file, validator, deps) {
  directoryChain(deps.root, path.dirname(file), deps);
  if (deps.platform === 'win32' && !deps.windowsAcl.verify(file)) {
    throw new Error('active workspace private file ACL is invalid');
  }
  let data;
  try {
    ({ data } = readPrivateFileBounded(file, {
      maxBytes: MAX_RUNTIME_DOCUMENT_BYTES,
      minBytes: 2,
      platform: deps.platform,
      fileSystem: deps.fileSystem,
    }));
  } catch (error) {
    throw new Error('active workspace private document could not be read', { cause: error });
  }
  try {
    return validator(JSON.parse(data.toString('utf8')));
  } catch (error) {
    throw new Error('active workspace document is invalid', { cause: error });
  } finally {
    data.fill(0);
  }
}

function credentialReceipt(file, deps) {
  directoryChain(deps.root, path.dirname(file), deps);
  const receipt = collectPrivateFileReceipt({
    file,
    maxBytes: MAX_RUNTIME_CREDENTIAL_BYTES,
    fileSystem: deps.fileSystem,
    platform: deps.platform,
    windowsAcl: deps.windowsAcl,
    label: 'active workspace VPN credential',
  });
  if (receipt.present && receipt.bytes < 1) {
    throw new Error('active workspace VPN credential is empty');
  }
  return receipt;
}

function bindingFrom(profile, profileState, account) {
  return Object.freeze({
    profileId: profile.profileId,
    profileCredentialBindingRevision: profileState.profileCredentialBindingRevision,
    accountKey: account.accountKey,
    accountCredentialRevision: account.accountCredentialRevision,
    gatewayOrigin: profile.gateway.origin.origin,
    protocolFamily: profile.gateway.protocolFamily,
  });
}

function authorityDependencies({ userData, profile: rawProfile, fileSystem, platform, windowsAcl }) {
  if (!fileSystem || typeof fileSystem.openSync !== 'function' ||
      !['darwin', 'linux', 'win32'].includes(platform) ||
      (platform === 'win32' && typeof windowsAcl?.verify !== 'function')) {
    throw new TypeError('active workspace authority dependencies are invalid');
  }
  const root = validateUserDataRoot(userData);
  const profile = validateSchoolProfileDocument(rawProfile);
  return { root, profile, fileSystem, platform, windowsAcl };
}

function loadActiveProfileAccountAuthority({
  userData,
  profile: rawProfile,
  fileSystem = fs,
  platform = process.platform,
  windowsAcl = {
    protect: protectWindowsFileOwnerOnly,
    verify: verifyWindowsFileOwnerOnly,
  },
} = {}) {
  const deps = authorityDependencies({
    userData,
    profile: rawProfile,
    fileSystem,
    platform,
    windowsAcl,
  });
  const { root, profile } = deps;
  const globalSettings = readDocument(
    path.join(root, 'global', 'settings.json'),
    validateGlobalSettingsDocument,
    deps,
  );
  const bootstrap = createProfileAccountBootstrapLayout({
    userData: root,
    profileKey: globalSettings.activeProfileKey,
    accountKey: globalSettings.activeAccountKey,
  });
  const globalUpdateState = readDocument(
    bootstrap.global.updateState,
    validateGlobalUpdateStateDocument,
    deps,
  );
  const profileSettings = readDocument(
    bootstrap.profile.settings,
    validateProfileSettingsDocument,
    deps,
  );
  const profileState = readDocument(
    bootstrap.profile.state,
    validateProfileStateDocument,
    deps,
  );
  const account = readDocument(
    bootstrap.account.document,
    validateCampusAccountDocument,
    deps,
  );

  equal(profileSettings.profileId, profile.profileId, 'Profile ID');
  equal(profileSettings.profileRevision, profile.profileRevision, 'Profile revision');
  equal(profileSettings.primaryAccountKey, globalSettings.activeAccountKey, 'primary account');
  equal(profileState.profileId, profile.profileId, 'Profile state ID');
  equal(profileState.profileRevision, profile.profileRevision, 'Profile state revision');
  equal(
    profileState.profileCredentialBindingRevision,
    profile.profileCredentialBindingRevision,
    'Profile credential revision',
  );
  equal(profileState.gatewayOrigin, profile.gateway.origin.origin, 'Gateway origin');
  equal(profileState.protocolFamily, profile.gateway.protocolFamily, 'ProtocolFamily');
  equal(account.accountKey, globalSettings.activeAccountKey, 'account key');
  equal(account.profileId, profile.profileId, 'account Profile ID');
  equal(account.profileRevision, profile.profileRevision, 'account Profile revision');
  equal(account.gatewayOrigin.origin, profile.gateway.origin.origin, 'account Gateway origin');
  equal(account.protocolFamily, profile.gateway.protocolFamily, 'account ProtocolFamily');
  if (account.role !== 'primary' || account.state !== 'enabled') {
    throw new Error('active workspace account is not an enabled primary account');
  }

  const layout = createProfileAccountWorkspaceLayout({
    userData: root,
    profileKey: globalSettings.activeProfileKey,
    accountKey: globalSettings.activeAccountKey,
    workspaceKey: account.workspaceKey,
    adoptLegacyHkustBrowserPartition: profile.evidenceClass === 'builtin-reviewed' &&
      profile.profileId === 'hkustgz',
  });
  const workspaceState = readDocument(
    layout.workspace.state,
    (value) => validateWorkspaceScopeDocument(value, { account }),
    deps,
  );

  return Object.freeze({
    profile,
    layout,
    globalSettings,
    globalUpdateState,
    profileSettings,
    profileState,
    account,
    workspaceState,
    credentialBinding: bindingFrom(profile, profileState, account),
  });
}

function loadActiveProfileWorkspaceAuthority(options = {}) {
  const fileSystem = options.fileSystem || fs;
  const platform = options.platform || process.platform;
  const windowsAcl = options.windowsAcl || {
    protect: protectWindowsFileOwnerOnly,
    verify: verifyWindowsFileOwnerOnly,
  };
  const accountAuthority = loadActiveProfileAccountAuthority({
    ...options,
    fileSystem,
    platform,
    windowsAcl,
  });
  const { layout } = accountAuthority;
  const root = validateUserDataRoot(options.userData);
  const deps = { root, fileSystem, platform, windowsAcl };
  const workspaceSettings = readDocument(
    layout.workspace.settings,
    validateWorkspaceSettingsDocument,
    deps,
  );
  const localResources = readDocument(
    layout.workspace.localResources,
    validateLocalResourcesDocument,
    deps,
  );
  const observedCredential = credentialReceipt(layout.account.vpnCredential, deps);
  equal(
    observedCredential.present,
    accountAuthority.account.activeCredentialVersion !== null,
    'credential presence',
  );

  return Object.freeze({
    ...accountAuthority,
    layout,
    workspaceSettings,
    localResources,
    hasCredential: observedCredential.present,
  });
}

function loadProfileWorkspaceAuthorityByKeys({
  userData,
  profile: rawProfile,
  profileKey,
  accountKey,
  adoptLegacyHkustBrowserPartition = false,
  fileSystem = fs,
  platform = process.platform,
  windowsAcl = {
    protect: protectWindowsFileOwnerOnly,
    verify: verifyWindowsFileOwnerOnly,
  },
} = {}) {
  const deps = authorityDependencies({
    userData,
    profile: rawProfile,
    fileSystem,
    platform,
    windowsAcl,
  });
  const { root, profile } = deps;
  const bootstrap = createProfileAccountBootstrapLayout({
    userData: root,
    profileKey,
    accountKey,
  });
  const profileSettings = readDocument(
    bootstrap.profile.settings,
    validateProfileSettingsDocument,
    deps,
  );
  const profileState = readDocument(
    bootstrap.profile.state,
    validateProfileStateDocument,
    deps,
  );
  const account = readDocument(
    bootstrap.account.document,
    validateCampusAccountDocument,
    deps,
  );
  equal(profileSettings.profileId, profile.profileId, 'Profile ID');
  equal(profileSettings.profileRevision, profile.profileRevision, 'Profile revision');
  equal(profileSettings.primaryAccountKey, accountKey, 'primary account');
  equal(profileState.profileId, profile.profileId, 'Profile state ID');
  equal(profileState.profileRevision, profile.profileRevision, 'Profile state revision');
  equal(profileState.profileCredentialBindingRevision,
    profile.profileCredentialBindingRevision, 'Profile credential revision');
  equal(profileState.gatewayOrigin, profile.gateway.origin.origin, 'Gateway origin');
  equal(profileState.protocolFamily, profile.gateway.protocolFamily, 'ProtocolFamily');
  equal(account.accountKey, accountKey, 'account key');
  equal(account.profileId, profile.profileId, 'account Profile ID');
  equal(account.profileRevision, profile.profileRevision, 'account Profile revision');
  equal(account.gatewayOrigin.origin, profile.gateway.origin.origin, 'account Gateway origin');
  equal(account.protocolFamily, profile.gateway.protocolFamily, 'account ProtocolFamily');
  if (account.role !== 'primary' || account.state !== 'enabled') {
    throw new Error('Profile workspace account is not an enabled primary account');
  }
  const layout = createProfileAccountWorkspaceLayout({
    userData: root,
    profileKey,
    accountKey,
    workspaceKey: account.workspaceKey,
    adoptLegacyHkustBrowserPartition,
  });
  const workspaceState = readDocument(
    layout.workspace.state,
    (value) => validateWorkspaceScopeDocument(value, { account }),
    deps,
  );
  const workspaceSettings = readDocument(
    layout.workspace.settings,
    validateWorkspaceSettingsDocument,
    deps,
  );
  const localResources = readDocument(
    layout.workspace.localResources,
    validateLocalResourcesDocument,
    deps,
  );
  const observedCredential = credentialReceipt(layout.account.vpnCredential, deps);
  equal(observedCredential.present, account.activeCredentialVersion !== null, 'credential presence');
  return Object.freeze({
    profile,
    layout,
    profileSettings,
    profileState,
    account,
    workspaceState,
    workspaceSettings,
    localResources,
    hasCredential: observedCredential.present,
    credentialBinding: bindingFrom(profile, profileState, account),
  });
}

module.exports = {
  MAX_RUNTIME_CREDENTIAL_BYTES,
  MAX_RUNTIME_DOCUMENT_BYTES,
  loadActiveProfileAccountAuthority,
  loadActiveProfileWorkspaceAuthority,
  loadProfileWorkspaceAuthorityByKeys,
};
