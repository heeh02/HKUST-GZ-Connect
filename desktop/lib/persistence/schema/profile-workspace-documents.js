'use strict';

const { validateCustomResourceDocument } = require('../../resources/schema/campus-resource-contract');
const { normalizeRouteDomains } = require('../../routing/pac/pac');
const {
  normalizeGatewayOrigin,
  validateOpaqueKey,
  validateProfileId,
  validateProtocolFamily,
} = require('../../profiles/schema/school-profile-schema');
const {
  PROXY_SECURITY_VERSION,
  isValidPort,
  normalizeHiddenBuiltinResourceIds,
} = require('../settings/settings-store');

const PROFILE_WORKSPACE_DOCUMENT_VERSION = 1;

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
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} has an invalid schema`);
  }
  return source;
}

function positive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function boolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
  return value;
}

function documentVersion(value, name) {
  if (value !== PROFILE_WORKSPACE_DOCUMENT_VERSION) {
    throw new TypeError(`${name} schema version is unsupported`);
  }
  return PROFILE_WORKSPACE_DOCUMENT_VERSION;
}

function validateGlobalSettingsDocument(value) {
  const source = exactKeys(value, [
    'schemaVersion', 'activeProfileKey', 'activeAccountKey', 'port', 'strictProxyAuth',
    'proxySecurityVersion', 'proxyAuthMigrationPending', 'closeAction', 'language',
    'startAtLogin',
  ], 'global settings');
  if (!isValidPort(source.port) || source.proxySecurityVersion !== PROXY_SECURITY_VERSION ||
      !['ask', 'minimize', 'quit'].includes(source.closeAction) ||
      !['auto', 'zh', 'en'].includes(source.language)) {
    throw new TypeError('global settings contain an unsupported value');
  }
  const strictProxyAuth = boolean(source.strictProxyAuth, 'strictProxyAuth');
  const proxyAuthMigrationPending = boolean(
    source.proxyAuthMigrationPending,
    'proxyAuthMigrationPending',
  );
  if (strictProxyAuth && proxyAuthMigrationPending) {
    throw new TypeError('strict proxy authentication cannot have a pending compatibility decision');
  }
  return Object.freeze({
    schemaVersion: documentVersion(source.schemaVersion, 'global settings'),
    activeProfileKey: validateOpaqueKey(source.activeProfileKey, 'activeProfileKey'),
    activeAccountKey: validateOpaqueKey(source.activeAccountKey, 'activeAccountKey'),
    port: source.port,
    strictProxyAuth,
    proxySecurityVersion: PROXY_SECURITY_VERSION,
    proxyAuthMigrationPending,
    closeAction: source.closeAction,
    language: source.language,
    startAtLogin: boolean(source.startAtLogin, 'startAtLogin'),
  });
}

function validateGlobalUpdateStateDocument(value) {
  const source = exactKeys(value, ['schemaVersion', 'checkedAt'], 'global update state');
  if (!Number.isSafeInteger(source.checkedAt) || source.checkedAt < 0) {
    throw new TypeError('global update timestamp is invalid');
  }
  return Object.freeze({
    schemaVersion: documentVersion(source.schemaVersion, 'global update state'),
    checkedAt: source.checkedAt,
  });
}

function validateProfileSettingsDocument(value) {
  const source = exactKeys(value, [
    'schemaVersion', 'profileId', 'profileRevision', 'primaryAccountKey',
  ], 'profile settings');
  return Object.freeze({
    schemaVersion: documentVersion(source.schemaVersion, 'profile settings'),
    profileId: validateProfileId(source.profileId),
    profileRevision: positive(source.profileRevision, 'profileRevision'),
    primaryAccountKey: validateOpaqueKey(source.primaryAccountKey, 'primaryAccountKey'),
  });
}

function validateProfileStateDocument(value) {
  const source = exactKeys(value, [
    'schemaVersion', 'migrationId', 'profileId', 'profileRevision',
    'profileCredentialBindingRevision', 'gatewayOrigin', 'protocolFamily',
  ], 'profile state');
  return Object.freeze({
    schemaVersion: documentVersion(source.schemaVersion, 'profile state'),
    migrationId: validateOpaqueKey(source.migrationId, 'migrationId'),
    profileId: validateProfileId(source.profileId),
    profileRevision: positive(source.profileRevision, 'profileRevision'),
    profileCredentialBindingRevision: positive(
      source.profileCredentialBindingRevision,
      'profileCredentialBindingRevision',
    ),
    gatewayOrigin: normalizeGatewayOrigin(source.gatewayOrigin).origin,
    protocolFamily: validateProtocolFamily(source.protocolFamily),
  });
}

function validateWorkspaceSettingsDocument(value) {
  const source = exactKeys(value, [
    'schemaVersion', 'autoReconnect', 'maxAttempts', 'autoConnect', 'routeDomains',
  ], 'workspace settings');
  if (!Number.isSafeInteger(source.maxAttempts) || source.maxAttempts < 0 ||
      source.maxAttempts > 10 || !Array.isArray(source.routeDomains) ||
      source.routeDomains.length > 64) {
    throw new TypeError('workspace settings contain an unsupported value');
  }
  const routeDomains = normalizeRouteDomains(source.routeDomains, []);
  if (routeDomains.length !== source.routeDomains.length ||
      routeDomains.some((domain, index) => domain !== source.routeDomains[index])) {
    throw new TypeError('workspace route domains are not canonical');
  }
  return Object.freeze({
    schemaVersion: documentVersion(source.schemaVersion, 'workspace settings'),
    autoReconnect: boolean(source.autoReconnect, 'autoReconnect'),
    maxAttempts: source.maxAttempts,
    autoConnect: boolean(source.autoConnect, 'autoConnect'),
    routeDomains: Object.freeze(routeDomains),
  });
}

function validateLocalResourcesDocument(value) {
  const input = plainObject(value, 'local resources');
  const legacy = Object.keys(input).sort().join(',') === 'resources,schemaVersion';
  const source = legacy
    ? { ...input, hiddenBuiltinResourceIds: [] }
    : exactKeys(
      input,
      ['schemaVersion', 'resources', 'hiddenBuiltinResourceIds'],
      'local resources',
    );
  const resources = validateCustomResourceDocument(source.resources).map((resource) => Object.freeze({
    id: resource.id,
    name: resource.name,
    description: resource.description,
    url: resource.url,
    route: resource.route,
    category: resource.category,
    keywords: resource.keywords,
  }));
  const hiddenBuiltinResourceIds = normalizeHiddenBuiltinResourceIds(
    source.hiddenBuiltinResourceIds,
  );
  if (!Array.isArray(source.hiddenBuiltinResourceIds) ||
      hiddenBuiltinResourceIds.length !== source.hiddenBuiltinResourceIds.length ||
      hiddenBuiltinResourceIds.some((id, index) => id !== source.hiddenBuiltinResourceIds[index])) {
    throw new TypeError('hidden builtin resource IDs are not canonical');
  }
  return Object.freeze({
    schemaVersion: documentVersion(source.schemaVersion, 'local resources'),
    resources: Object.freeze(resources),
    hiddenBuiltinResourceIds: Object.freeze(hiddenBuiltinResourceIds),
  });
}

module.exports = {
  PROFILE_WORKSPACE_DOCUMENT_VERSION,
  validateGlobalSettingsDocument,
  validateGlobalUpdateStateDocument,
  validateLocalResourcesDocument,
  validateProfileSettingsDocument,
  validateProfileStateDocument,
  validateWorkspaceSettingsDocument,
};
