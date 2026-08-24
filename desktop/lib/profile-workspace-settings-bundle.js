'use strict';

const { isDeepStrictEqual } = require('node:util');
const { parseCredentialField } = require('./settings-update');
const { DEFAULTS, normalizeSettings } = require('./settings-store');
const {
  validateGlobalSettingsDocument,
  validateGlobalUpdateStateDocument,
  validateLocalResourcesDocument,
  validateWorkspaceSettingsDocument,
} = require('./profile-workspace-documents');

const LEGACY_SETTINGS_KEYS = Object.freeze(Object.keys(DEFAULTS).sort());

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exactLegacySettings(value) {
  const source = plainObject(value, 'runtime settings projection');
  const keys = Object.keys(source).sort();
  if (keys.length !== LEGACY_SETTINGS_KEYS.length ||
      keys.some((key, index) => key !== LEGACY_SETTINGS_KEYS[index])) {
    throw new TypeError('runtime settings projection has an invalid schema');
  }
  const normalized = normalizeSettings(source);
  if (!isDeepStrictEqual(source, normalized)) {
    throw new TypeError('runtime settings projection is not canonical');
  }
  if (source.username.length > 256) {
    throw new TypeError('runtime account label is too long');
  }
  parseCredentialField(source.username, 'account');
  return normalized;
}

function validateAuthority(value) {
  const authority = plainObject(value, 'active workspace authority');
  for (const key of [
    'globalSettings', 'globalUpdateState', 'workspaceSettings', 'localResources',
  ]) {
    if (!authority[key]) throw new TypeError(`active workspace authority lacks ${key}`);
  }
  return authority;
}

function projectRuntimeSettings(authorityValue, { accountLabel = '' } = {}) {
  const authority = validateAuthority(authorityValue);
  const global = validateGlobalSettingsDocument(authority.globalSettings);
  const update = validateGlobalUpdateStateDocument(authority.globalUpdateState);
  const workspace = validateWorkspaceSettingsDocument(authority.workspaceSettings);
  const local = validateLocalResourcesDocument(authority.localResources);
  const username = parseCredentialField(accountLabel, 'account');
  if (username.length > 256) throw new TypeError('runtime account label is too long');
  return Object.freeze(normalizeSettings({
    username,
    port: global.port,
    autoReconnect: workspace.autoReconnect,
    maxAttempts: workspace.maxAttempts,
    startAtLogin: global.startAtLogin,
    autoConnect: workspace.autoConnect,
    strictProxyAuth: global.strictProxyAuth,
    proxySecurityVersion: global.proxySecurityVersion,
    proxyAuthMigrationPending: global.proxyAuthMigrationPending,
    closeAction: global.closeAction,
    language: global.language,
    updateCheckedAt: update.checkedAt,
    routeDomains: workspace.routeDomains,
    customResources: local.resources,
  }));
}

function splitRuntimeSettings(authorityValue, settingsValue) {
  const authority = validateAuthority(authorityValue);
  const settings = exactLegacySettings(settingsValue);
  return Object.freeze({
    globalSettings: validateGlobalSettingsDocument({
      ...authority.globalSettings,
      port: settings.port,
      strictProxyAuth: settings.strictProxyAuth,
      proxySecurityVersion: settings.proxySecurityVersion,
      proxyAuthMigrationPending: settings.proxyAuthMigrationPending,
      closeAction: settings.closeAction,
      language: settings.language,
      startAtLogin: settings.startAtLogin,
    }),
    globalUpdateState: validateGlobalUpdateStateDocument({
      schemaVersion: 1,
      checkedAt: settings.updateCheckedAt,
    }),
    workspaceSettings: validateWorkspaceSettingsDocument({
      schemaVersion: 1,
      autoReconnect: settings.autoReconnect,
      maxAttempts: settings.maxAttempts,
      autoConnect: settings.autoConnect,
      routeDomains: settings.routeDomains,
    }),
    localResources: validateLocalResourcesDocument({
      schemaVersion: 1,
      resources: settings.customResources,
    }),
  });
}

module.exports = {
  LEGACY_SETTINGS_KEYS,
  projectRuntimeSettings,
  splitRuntimeSettings,
};
