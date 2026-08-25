'use strict';

const crypto = require('node:crypto');
const {
  validateLocalResourcesDocument,
  validateProfileSettingsDocument,
  validateProfileStateDocument,
  validateWorkspaceSettingsDocument,
} = require('./profile-workspace-documents');
const {
  createProfileAccountWorkspaceLayout,
} = require('./profile-workspace-layout');
const {
  PROTOCOL_FAMILY,
  validateCampusAccountDocument,
  validateProfileId,
  validateSchoolProfileDocument,
  validateWorkspaceScopeDocument,
} = require('./school-profile-schema');

const CUSTOM_PROFILE_PROVISIONING_VERSION = 1;

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, name) {
  const source = plainObject(value, name);
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} has an invalid schema`);
  }
  return source;
}

function timestamp(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('custom Profile provisioning timestamp is invalid');
  }
  return value;
}

function entropyKey(prefix, randomBytes) {
  let entropy = randomBytes(16);
  if (!Buffer.isBuffer(entropy) || entropy.length !== 16) {
    entropy?.fill?.(0);
    throw new TypeError('custom Profile provisioning entropy is invalid');
  }
  try { return `${prefix}-${entropy.toString('hex')}`; }
  finally { entropy.fill(0); entropy = null; }
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createCustomProfileProvisioningIdentity({ profileId, randomBytes = crypto.randomBytes } = {}) {
  const id = validateProfileId(profileId);
  if (!id.startsWith('custom-') || typeof randomBytes !== 'function') {
    throw new TypeError('custom Profile provisioning identity is invalid');
  }
  return Object.freeze({
    provisioningId: entropyKey('provision', randomBytes),
    profileId: id,
    profileKey: entropyKey('profile', randomBytes),
    accountKey: entropyKey('account', randomBytes),
    workspaceKey: entropyKey('workspace', randomBytes),
  });
}

function createCustomProfileProvisioningPlan({
  userData,
  confirmation,
  identity,
  now = Date.now,
} = {}) {
  if (typeof now !== 'function') throw new TypeError('custom Profile provisioning clock is invalid');
  const consumed = exactKeys(confirmation, [
    'draftProfileId', 'normalizedOrigin', 'candidateFamily', 'profileDocument', 'profile',
  ], 'consumed Gateway confirmation');
  const keys = exactKeys(identity, [
    'provisioningId', 'profileId', 'profileKey', 'accountKey', 'workspaceKey',
  ], 'custom Profile provisioning identity');
  const profile = validateSchoolProfileDocument(consumed.profileDocument);
  if (profile.evidenceClass !== 'custom-local' || profile.profileId !== consumed.draftProfileId ||
      profile.profileId !== keys.profileId || profile.gateway.origin.origin !== consumed.normalizedOrigin ||
      profile.gateway.protocolFamily !== consumed.candidateFamily ||
      consumed.candidateFamily !== PROTOCOL_FAMILY ||
      JSON.stringify(profile) !== JSON.stringify(consumed.profile)) {
    throw new TypeError('consumed Gateway confirmation does not match its custom Profile');
  }
  const createdAt = timestamp(now());
  const accountDocument = validateCampusAccountDocument({
    schemaVersion: 1,
    accountKey: keys.accountKey,
    accountRevision: 1,
    accountCredentialRevision: 1,
    role: 'primary',
    state: 'enabled',
    profileId: profile.profileId,
    profileRevision: profile.profileRevision,
    gatewayOrigin: profile.gateway.origin.origin,
    protocolFamily: profile.gateway.protocolFamily,
    workspaceKey: keys.workspaceKey,
    activeCredentialVersion: null,
    createdAt,
    updatedAt: createdAt,
  });
  const workspaceDocument = validateWorkspaceScopeDocument({
    schemaVersion: 1,
    profileId: profile.profileId,
    profileRevision: profile.profileRevision,
    accountKey: keys.accountKey,
    accountRevision: accountDocument.accountRevision,
    workspaceKey: keys.workspaceKey,
    activeContextEpoch: 1,
  }, { account: accountDocument });
  const layout = createProfileAccountWorkspaceLayout({
    userData,
    profileKey: keys.profileKey,
    accountKey: keys.accountKey,
    workspaceKey: keys.workspaceKey,
    adoptLegacyHkustBrowserPartition: false,
  });
  const documents = {
    schoolProfile: consumed.profileDocument,
    profileSettings: validateProfileSettingsDocument({
      schemaVersion: 1,
      profileId: profile.profileId,
      profileRevision: profile.profileRevision,
      primaryAccountKey: keys.accountKey,
    }),
    profileState: validateProfileStateDocument({
      schemaVersion: 1,
      migrationId: keys.provisioningId,
      profileId: profile.profileId,
      profileRevision: profile.profileRevision,
      profileCredentialBindingRevision: profile.profileCredentialBindingRevision,
      gatewayOrigin: profile.gateway.origin.origin,
      protocolFamily: profile.gateway.protocolFamily,
    }),
    account: accountDocument,
    workspaceSettings: validateWorkspaceSettingsDocument({
      schemaVersion: 1,
      autoReconnect: true,
      maxAttempts: 3,
      autoConnect: false,
      routeDomains: [],
    }),
    workspaceState: workspaceDocument,
    localResources: validateLocalResourcesDocument({ schemaVersion: 1, resources: [] }),
    favorites: Object.freeze({ schemaVersion: 1, entries: Object.freeze([]) }),
    recentResources: Object.freeze({ schemaVersion: 1, entries: Object.freeze([]) }),
    externalIntegrations: Object.freeze({ schemaVersion: 1, entries: Object.freeze([]) }),
  };
  const paths = Object.freeze({
    schoolProfile: layout.profile.document,
    profileSettings: layout.profile.settings,
    profileState: layout.profile.state,
    account: layout.account.document,
    workspaceSettings: layout.workspace.settings,
    workspaceState: layout.workspace.state,
    localResources: layout.workspace.localResources,
    favorites: layout.workspace.favorites,
    recentResources: layout.workspace.recentResources,
    externalIntegrations: layout.workspace.externalIntegrations,
  });
  const files = Object.freeze(Object.fromEntries(Object.entries(documents).map(([name, document]) => (
    [name, jsonBuffer(document)]
  ))));
  return Object.freeze({
    schemaVersion: CUSTOM_PROFILE_PROVISIONING_VERSION,
    identity: Object.freeze({ ...keys }),
    context: Object.freeze({
      profileId: profile.profileId,
      profileKey: keys.profileKey,
      profileRevision: profile.profileRevision,
      profileCredentialBindingRevision: profile.profileCredentialBindingRevision,
      accountKey: keys.accountKey,
      accountRevision: accountDocument.accountRevision,
      accountCredentialRevision: accountDocument.accountCredentialRevision,
      workspaceKey: keys.workspaceKey,
      activeContextEpoch: workspaceDocument.activeContextEpoch,
    }),
    layout,
    paths,
    files,
  });
}

module.exports = {
  CUSTOM_PROFILE_PROVISIONING_VERSION,
  createCustomProfileProvisioningIdentity,
  createCustomProfileProvisioningPlan,
};
