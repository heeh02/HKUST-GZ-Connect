'use strict';

const crypto = require('node:crypto');
const {
  createIntegrationBinding,
} = require('./integration-schema');
const {
  createProfileNetworkRules,
} = require('./profile-network-rules');
const {
  validateCampusAccountDocument,
  validateSchoolProfileDocument,
  validateWorkspaceScopeDocument,
} = require('../profiles/schema/school-profile-schema');

function pacDigest(value) {
  if (typeof value !== 'string' || !value.includes('function FindProxyForURL') ||
      Buffer.byteLength(value, 'utf8') > 512 * 1024) {
    throw new TypeError('integration PAC source is invalid');
  }
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function createIntegrationRuntimeContext({
  authority,
  profileDocument,
  settings,
  userRules = [],
  serverResources = [],
  campusCidrs = [],
  proxyCredential,
  pacSource,
  engineGeneration = null,
} = {}) {
  const profile = validateSchoolProfileDocument(profileDocument);
  const account = validateCampusAccountDocument(authority?.account);
  const workspace = validateWorkspaceScopeDocument(authority?.workspaceState, { account });
  if (account.profileId !== profile.profileId || account.profileRevision !== profile.profileRevision ||
      account.gatewayOrigin.origin !== profile.gateway.origin.origin ||
      account.accountKey !== workspace.accountKey || typeof settings !== 'object' ||
      settings.strictProxyAuth !== true || !Number.isInteger(settings.port) ||
      settings.port < 1025 || settings.port > 65535 ||
      !proxyCredential || typeof proxyCredential.reference !== 'function' ||
      typeof proxyCredential.withStrings !== 'function') {
    const error = new Error('integration runtime context is unavailable or incompatible');
    error.code = settings?.strictProxyAuth === false
      ? 'INTEGRATION_AUTH_INCOMPATIBLE'
      : 'INTEGRATION_LISTENER_UNAVAILABLE';
    throw error;
  }
  const networkRules = createProfileNetworkRules({
    profileDocument,
    accountCampusDomains: settings.routeDomains,
    userRules,
    customResources: settings.customResources,
    serverResources,
    campusCidrs,
  });
  const common = Object.freeze({
    profileId: profile.profileId,
    profileRevision: profile.profileRevision,
    profileCredentialBindingRevision: profile.profileCredentialBindingRevision,
    accountKey: account.accountKey,
    accountRevision: account.accountRevision,
    accountCredentialRevision: account.accountCredentialRevision,
    workspaceKey: workspace.workspaceKey,
    activeContextEpoch: workspace.activeContextEpoch,
    listenerKind: 'socks5-authenticated',
    loopbackHost: '127.0.0.1',
    loopbackPort: settings.port,
    proxySecurityRevision: settings.proxySecurityVersion,
    credentialRef: proxyCredential.reference(),
    networkRulesDigest: networkRules.rulesDigest,
    pacDigest: pacDigest(pacSource),
    engineGeneration,
  });
  return Object.freeze({
    networkRules,
    pacSource,
    port: settings.port,
    credential: proxyCredential,
    bindingFor(adapterId, recordRevision = 1) {
      return createIntegrationBinding({
        ...common, adapterId, adapterVersion: 1, recordRevision,
      });
    },
  });
}

module.exports = { createIntegrationRuntimeContext, integrationPacDigest: pacDigest };
