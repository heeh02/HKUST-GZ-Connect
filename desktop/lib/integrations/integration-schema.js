'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const {
  validateOpaqueKey,
  validateProfileId,
} = require('../profiles/schema/school-profile-schema');

const INTEGRATION_SCHEMA_VERSION = 1;
const INTEGRATION_ADAPTER_IDS = Object.freeze([
  'clash_yaml',
  'mihomo_yaml',
  'clash_verge_rev_managed',
  'openssh_proxy_command',
  'vscode_remote_ssh',
  'pac',
  'manual_export',
  'user_selected_managed_block',
]);
const INTEGRATION_ACTIONS = Object.freeze([
  'preview', 'copy', 'save', 'install', 'update', 'remove',
]);
const ADAPTERS = Object.freeze({
  clash_yaml: Object.freeze({ displayName: 'Clash YAML', actions: ['preview', 'copy', 'save'] }),
  mihomo_yaml: Object.freeze({ displayName: 'Mihomo YAML', actions: ['preview', 'copy', 'save'] }),
  clash_verge_rev_managed: Object.freeze({
    displayName: 'Clash Verge Rev', actions: ['preview', 'install', 'update', 'remove'],
  }),
  openssh_proxy_command: Object.freeze({
    displayName: 'OpenSSH', actions: ['preview', 'install', 'update', 'remove'],
  }),
  vscode_remote_ssh: Object.freeze({
    displayName: 'VS Code Remote-SSH', actions: ['preview', 'copy'],
  }),
  pac: Object.freeze({ displayName: 'PAC', actions: ['preview', 'copy', 'save'] }),
  manual_export: Object.freeze({
    displayName: 'Manual configuration', actions: ['preview', 'copy', 'save'],
  }),
  user_selected_managed_block: Object.freeze({
    displayName: 'Managed configuration block', actions: ['preview', 'install', 'update', 'remove'],
  }),
});
const COMPATIBILITY_STATES = Object.freeze(['supported', 'unsupported', 'unavailable', 'conflict']);
const BINDING_STATES = Object.freeze(['not-installed', 'current', 'stale', 'unavailable']);
const LISTENER_KINDS = Object.freeze(['socks5-authenticated', 'http-connect-authenticated']);
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$/u;

function plain(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exact(value, keys, name) {
  const source = plain(value, name);
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} has an invalid schema`);
  }
  return source;
}

function positive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} is invalid`);
  return value;
}

function digest(value, name) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function adapterId(value) {
  if (!INTEGRATION_ADAPTER_IDS.includes(value)) throw new TypeError('integration adapter is unsupported');
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function createIntegrationBinding(value) {
  const source = exact(value, [
    'adapterId', 'adapterVersion', 'profileId', 'profileRevision',
    'profileCredentialBindingRevision', 'accountKey', 'accountRevision',
    'accountCredentialRevision', 'workspaceKey', 'activeContextEpoch',
    'listenerKind', 'loopbackHost', 'loopbackPort', 'proxySecurityRevision',
    'credentialRef', 'networkRulesDigest', 'pacDigest', 'engineGeneration',
    'recordRevision',
  ], 'integration binding input');
  if (!LISTENER_KINDS.includes(source.listenerKind) || source.loopbackHost !== '127.0.0.1' ||
      !Number.isInteger(source.loopbackPort) || source.loopbackPort < 1025 ||
      source.loopbackPort > 65535) {
    throw new TypeError('integration listener binding is invalid');
  }
  const normalized = Object.freeze({
    schemaVersion: INTEGRATION_SCHEMA_VERSION,
    adapterId: adapterId(source.adapterId),
    adapterVersion: positive(source.adapterVersion, 'adapterVersion'),
    profileId: validateProfileId(source.profileId),
    profileRevision: positive(source.profileRevision, 'profileRevision'),
    profileCredentialBindingRevision: positive(
      source.profileCredentialBindingRevision,
      'profileCredentialBindingRevision',
    ),
    accountKey: validateOpaqueKey(source.accountKey, 'integration accountKey'),
    accountRevision: positive(source.accountRevision, 'accountRevision'),
    accountCredentialRevision: positive(
      source.accountCredentialRevision,
      'accountCredentialRevision',
    ),
    workspaceKey: validateOpaqueKey(source.workspaceKey, 'integration workspaceKey'),
    activeContextEpoch: positive(source.activeContextEpoch, 'activeContextEpoch'),
    listenerKind: source.listenerKind,
    loopbackHost: '127.0.0.1',
    loopbackPort: source.loopbackPort,
    proxySecurityRevision: positive(source.proxySecurityRevision, 'proxySecurityRevision'),
    credentialRef: validateOpaqueKey(source.credentialRef, 'integration credentialRef'),
    networkRulesDigest: digest(source.networkRulesDigest, 'networkRulesDigest'),
    pacDigest: digest(source.pacDigest, 'pacDigest'),
    engineGeneration: source.engineGeneration == null
      ? null
      : positive(source.engineGeneration, 'engineGeneration'),
    recordRevision: positive(source.recordRevision, 'recordRevision'),
  });
  return Object.freeze({ ...normalized, bindingDigest: sha256(normalized) });
}

function validateIntegrationBinding(value) {
  const source = exact(value, [
    'schemaVersion', 'adapterId', 'adapterVersion', 'profileId', 'profileRevision',
    'profileCredentialBindingRevision', 'accountKey', 'accountRevision',
    'accountCredentialRevision', 'workspaceKey', 'activeContextEpoch',
    'listenerKind', 'loopbackHost', 'loopbackPort', 'proxySecurityRevision',
    'credentialRef', 'networkRulesDigest', 'pacDigest', 'engineGeneration',
    'recordRevision', 'bindingDigest',
  ], 'integration binding');
  if (source.schemaVersion !== INTEGRATION_SCHEMA_VERSION) {
    throw new TypeError('integration binding version is unsupported');
  }
  const input = Object.fromEntries(Object.entries(source).filter(([key]) => (
    key !== 'schemaVersion' && key !== 'bindingDigest'
  )));
  const normalized = createIntegrationBinding(input);
  if (normalized.bindingDigest !== source.bindingDigest) {
    throw new TypeError('integration binding digest does not match');
  }
  return normalized;
}

function bindingStateFor(installedValue, currentValue) {
  if (installedValue == null) return 'not-installed';
  let installed;
  let current;
  try {
    installed = validateIntegrationBinding(installedValue);
    current = validateIntegrationBinding(currentValue);
  } catch { return 'unavailable'; }
  return installed.bindingDigest === current.bindingDigest ? 'current' : 'stale';
}

function createIntegrationAdapterView({
  adapterId: rawAdapterId,
  compatibilityState,
  bindingState,
  updatedAt = null,
} = {}) {
  const id = adapterId(rawAdapterId);
  if (!COMPATIBILITY_STATES.includes(compatibilityState) ||
      !BINDING_STATES.includes(bindingState) ||
      (updatedAt !== null && (!Number.isSafeInteger(updatedAt) || updatedAt <= 0))) {
    throw new TypeError('integration adapter view is invalid');
  }
  return Object.freeze({
    schemaVersion: INTEGRATION_SCHEMA_VERSION,
    adapterId: id,
    displayName: ADAPTERS[id].displayName,
    supportedActions: Object.freeze([...ADAPTERS[id].actions]),
    compatibilityState,
    bindingState,
    updatedAt,
  });
}

function normalizedTargetFile(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 ||
      /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('integration target file is invalid');
  }
  const windows = /^(?:[a-zA-Z]:[\\/]|\\\\)/u.test(value);
  const posix = path.posix.isAbsolute(value);
  const flavor = windows ? path.win32 : path.posix;
  if ((!windows && !posix) || flavor.normalize(value) !== value || value === flavor.parse(value).root) {
    throw new TypeError('integration target file must be an absolute normalized non-root path');
  }
  return value;
}

function safeReference(value, name, { optional = false } = {}) {
  if (optional && value == null) return null;
  if (typeof value !== 'string' || value.length > 128 || !SAFE_REFERENCE.test(value)) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function validateIntegrationRecord(value) {
  const source = exact(value, [
    'schemaVersion', 'adapterId', 'adapterVersion', 'profileId', 'bindingDigest',
    'targetFile', 'installedRevision', 'installedDigest', 'managedBlockId',
    'backupReference', 'updatedAt',
  ], 'integration record');
  if (source.schemaVersion !== INTEGRATION_SCHEMA_VERSION) {
    throw new TypeError('integration record version is unsupported');
  }
  return Object.freeze({
    schemaVersion: INTEGRATION_SCHEMA_VERSION,
    adapterId: adapterId(source.adapterId),
    adapterVersion: positive(source.adapterVersion, 'adapterVersion'),
    profileId: validateProfileId(source.profileId),
    bindingDigest: digest(source.bindingDigest, 'bindingDigest'),
    targetFile: normalizedTargetFile(source.targetFile),
    installedRevision: positive(source.installedRevision, 'installedRevision'),
    installedDigest: digest(source.installedDigest, 'installedDigest'),
    managedBlockId: safeReference(source.managedBlockId, 'managedBlockId'),
    backupReference: safeReference(source.backupReference, 'backupReference', { optional: true }),
    updatedAt: positive(source.updatedAt, 'updatedAt'),
  });
}

function validateIntegrationRecordDocument(value) {
  const source = exact(value, ['schemaVersion', 'records'], 'integration record document');
  if (source.schemaVersion !== INTEGRATION_SCHEMA_VERSION || !Array.isArray(source.records) ||
      source.records.length > 64) {
    throw new TypeError('integration record document is invalid');
  }
  const records = source.records.map(validateIntegrationRecord);
  const identities = records.map((record) => (
    `${record.adapterId}\0${record.profileId}\0${record.managedBlockId}`
  ));
  if (new Set(identities).size !== identities.length) {
    throw new TypeError('integration record document contains duplicate ownership');
  }
  return Object.freeze({
    schemaVersion: INTEGRATION_SCHEMA_VERSION,
    records: Object.freeze(records.sort((left, right) => (
      left.adapterId.localeCompare(right.adapterId) ||
      left.profileId.localeCompare(right.profileId) ||
      left.managedBlockId.localeCompare(right.managedBlockId)
    ))),
  });
}

module.exports = {
  BINDING_STATES,
  COMPATIBILITY_STATES,
  INTEGRATION_ACTIONS,
  INTEGRATION_ADAPTER_IDS,
  INTEGRATION_SCHEMA_VERSION,
  bindingStateFor,
  createIntegrationAdapterView,
  createIntegrationBinding,
  normalizedIntegrationTargetFile: normalizedTargetFile,
  validateIntegrationBinding,
  validateIntegrationRecord,
  validateIntegrationRecordDocument,
};
