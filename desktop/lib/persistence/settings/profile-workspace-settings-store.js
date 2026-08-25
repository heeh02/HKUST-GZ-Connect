'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('../../credential-store');
const { collectPrivateFileReceipt } = require('../../legacy-flat-source-receipts');
const { readPrivateFileBounded } = require('../../private-file');
const { splitRuntimeSettings } = require('./profile-workspace-settings-bundle');
const {
  normalizeGatewayOrigin,
  validateOpaqueKey,
  validateProfileId,
  validateProtocolFamily,
} = require('../../profiles/schema/school-profile-schema');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('../../windows-private-file');

const SETTINGS_TRANSACTION_VERSION = 1;
const MAX_SETTINGS_TARGET_BYTES = 512 * 1024;
const MAX_SETTINGS_TRANSACTION_BYTES = 3 * 1024 * 1024;
const TARGET_IDS = Object.freeze([
  'globalSettings',
  'globalUpdateState',
  'workspaceSettings',
  'localResources',
]);
const DIGEST = /^[a-f0-9]{64}$/u;

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

function receipt(value) {
  if (!Buffer.isBuffer(value) || value.length < 1 || value.length > MAX_SETTINGS_TARGET_BYTES) {
    throw new TypeError('profile workspace settings target is invalid');
  }
  return Object.freeze({
    present: true,
    bytes: value.length,
    sha256: crypto.createHash('sha256').update(value).digest('hex'),
  });
}

function validateReceipt(value, name) {
  const source = exactKeys(value, ['present', 'bytes', 'sha256'], name);
  if (source.present !== true || !Number.isSafeInteger(source.bytes) || source.bytes < 1 ||
      source.bytes > MAX_SETTINGS_TARGET_BYTES || typeof source.sha256 !== 'string' ||
      !DIGEST.test(source.sha256)) {
    throw new TypeError(`${name} is invalid`);
  }
  return Object.freeze({ present: true, bytes: source.bytes, sha256: source.sha256 });
}

function sameReceipt(left, right) {
  return left.present === right.present && left.bytes === right.bytes && left.sha256 === right.sha256;
}

function validateBinding(value) {
  const source = exactKeys(value, [
    'profileId', 'profileKey', 'profileCredentialBindingRevision', 'accountKey',
    'accountCredentialRevision', 'workspaceKey', 'activeContextEpoch', 'gatewayOrigin',
    'protocolFamily',
  ], 'profile workspace settings binding');
  return Object.freeze({
    profileId: validateProfileId(source.profileId),
    profileKey: validateOpaqueKey(source.profileKey, 'profileKey'),
    profileCredentialBindingRevision: positive(
      source.profileCredentialBindingRevision,
      'profileCredentialBindingRevision',
    ),
    accountKey: validateOpaqueKey(source.accountKey, 'accountKey'),
    accountCredentialRevision: positive(
      source.accountCredentialRevision,
      'accountCredentialRevision',
    ),
    workspaceKey: validateOpaqueKey(source.workspaceKey, 'workspaceKey'),
    activeContextEpoch: positive(source.activeContextEpoch, 'activeContextEpoch'),
    gatewayOrigin: normalizeGatewayOrigin(source.gatewayOrigin).origin,
    protocolFamily: validateProtocolFamily(source.protocolFamily),
  });
}

function bindingFromAuthority(authority) {
  return validateBinding({
    profileId: authority.profile.profileId,
    profileKey: authority.layout.identity.profileKey,
    profileCredentialBindingRevision:
      authority.profileState.profileCredentialBindingRevision,
    accountKey: authority.account.accountKey,
    accountCredentialRevision: authority.account.accountCredentialRevision,
    workspaceKey: authority.workspaceState.workspaceKey,
    activeContextEpoch: authority.workspaceState.activeContextEpoch,
    gatewayOrigin: authority.profile.gateway.origin.origin,
    protocolFamily: authority.profile.gateway.protocolFamily,
  });
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function serializedDocuments(bundle) {
  const value = exactKeys(bundle, TARGET_IDS, 'profile workspace settings bundle');
  return Object.freeze(Object.fromEntries(TARGET_IDS.map((id) => [
    id,
    Buffer.from(`${JSON.stringify(value[id])}\n`, 'utf8'),
  ])));
}

function validateTarget(value, id) {
  const source = exactKeys(value, ['before', 'after', 'data'], `settings target ${id}`);
  const before = validateReceipt(source.before, `settings target ${id} before receipt`);
  const after = validateReceipt(source.after, `settings target ${id} after receipt`);
  if (typeof source.data !== 'string' || source.data.length < 4 ||
      source.data.length > Math.ceil(MAX_SETTINGS_TARGET_BYTES / 3) * 4 + 4) {
    throw new TypeError(`settings target ${id} data is invalid`);
  }
  const data = Buffer.from(source.data, 'base64');
  if (data.toString('base64') !== source.data || !sameReceipt(receipt(data), after)) {
    data.fill(0);
    throw new TypeError(`settings target ${id} data does not match its receipt`);
  }
  data.fill(0);
  return Object.freeze({ before, after, data: source.data });
}

function validateIntent(value, expectedBinding = null) {
  const source = exactKeys(value, [
    'schemaVersion', 'type', 'transactionId', 'binding', 'createdAt', 'targets',
  ], 'profile workspace settings transaction');
  if (source.schemaVersion !== SETTINGS_TRANSACTION_VERSION ||
      source.type !== 'profile_workspace_settings_commit') {
    throw new TypeError('profile workspace settings transaction is unsupported');
  }
  const binding = validateBinding(source.binding);
  if (expectedBinding && !sameDocument(binding, expectedBinding)) {
    throw new Error('profile workspace settings transaction binding does not match');
  }
  const targets = exactKeys(source.targets, TARGET_IDS, 'profile workspace settings targets');
  return Object.freeze({
    schemaVersion: SETTINGS_TRANSACTION_VERSION,
    type: 'profile_workspace_settings_commit',
    transactionId: validateOpaqueKey(source.transactionId, 'transactionId'),
    binding,
    createdAt: positive(source.createdAt, 'createdAt'),
    targets: Object.freeze(Object.fromEntries(TARGET_IDS.map((id) => [
      id,
      validateTarget(targets[id], id),
    ]))),
  });
}

function fsyncDirectory(directory, fileSystem, platform) {
  let descriptor = null;
  try {
    descriptor = fileSystem.openSync(directory, 'r');
    fileSystem.fsyncSync?.(descriptor);
    return true;
  } catch {
    return platform === 'win32';
  } finally {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
  }
}

function storageOptions(platform, windowsAcl) {
  return platform === 'win32' ? {
    protectTemporary: (temporary) => windowsAcl.protect(temporary) === true,
    verifyCommitted: (committed) => windowsAcl.verify(committed) === true,
    removeCommittedOnFailure: true,
  } : {};
}

class ProfileWorkspaceSettingsStore {
  constructor({
    loadAuthority,
    fileSystem = fs,
    platform = process.platform,
    windowsAcl = {
      protect: protectWindowsFileOwnerOnly,
      verify: verifyWindowsFileOwnerOnly,
    },
    randomBytes = crypto.randomBytes,
    now = Date.now,
  } = {}) {
    if (typeof loadAuthority !== 'function' || !fileSystem ||
        typeof fileSystem.openSync !== 'function' ||
        !['darwin', 'linux', 'win32'].includes(platform) ||
        (platform === 'win32' &&
          (typeof windowsAcl?.protect !== 'function' || typeof windowsAcl?.verify !== 'function')) ||
        typeof randomBytes !== 'function' || typeof now !== 'function') {
      throw new TypeError('profile workspace settings store dependencies are invalid');
    }
    this.loadAuthority = loadAuthority;
    this.fileSystem = fileSystem;
    this.platform = platform;
    this.windowsAcl = windowsAcl;
    this.randomBytes = randomBytes;
    this.now = now;
    this.running = false;
  }

  save(settings) {
    return this.#singleFlight(() => {
      this.#reconcileOnce();
      const authority = this.#authority();
      const bundle = splitRuntimeSettings(authority, settings);
      const documents = serializedDocuments(bundle);
      try {
        const paths = this.#paths(authority);
        const before = Object.fromEntries(TARGET_IDS.map((id) => [
          id,
          this.#receipt(paths[id]),
        ]));
        const after = Object.fromEntries(TARGET_IDS.map((id) => [id, receipt(documents[id])]));
        if (TARGET_IDS.every((id) => sameReceipt(before[id], after[id]))) {
          return Object.freeze({ changed: false, authority });
        }
        let entropy = this.randomBytes(16);
        if (!Buffer.isBuffer(entropy) || entropy.length !== 16) {
          entropy?.fill?.(0);
          throw new Error('profile workspace settings transaction entropy is invalid');
        }
        let transactionId;
        try {
          transactionId = `transaction-${entropy.toString('hex')}`;
        } finally {
          entropy.fill(0);
          entropy = null;
        }
        const intent = validateIntent({
          schemaVersion: SETTINGS_TRANSACTION_VERSION,
          type: 'profile_workspace_settings_commit',
          transactionId,
          binding: bindingFromAuthority(authority),
          createdAt: this.now(),
          targets: Object.fromEntries(TARGET_IDS.map((id) => [id, {
            before: before[id],
            after: after[id],
            data: documents[id].toString('base64'),
          }])),
        });
        this.#writeIntent(paths.intent, intent);
        this.#resume(intent, authority);
        return Object.freeze({ changed: true, authority: this.#authority() });
      } finally {
        for (const document of Object.values(documents)) document.fill(0);
      }
    });
  }

  reconcile() {
    return this.#singleFlight(() => this.#reconcileOnce());
  }

  #reconcileOnce() {
    const initialAuthority = this.#authority();
    const paths = this.#paths(initialAuthority);
    const intent = this.#readIntent(paths.intent, bindingFromAuthority(initialAuthority));
    if (!intent) return Object.freeze({ changed: false, authority: initialAuthority });
    this.#resume(intent, initialAuthority);
    return Object.freeze({ changed: true, authority: this.#authority() });
  }

  #resume(intent, authority) {
    const binding = bindingFromAuthority(authority);
    if (!sameDocument(intent.binding, binding)) {
      throw new Error('profile workspace settings transaction binding does not match');
    }
    const paths = this.#paths(authority);
    for (const id of TARGET_IDS) {
      const target = intent.targets[id];
      const current = this.#receipt(paths[id]);
      if (sameReceipt(current, target.after)) continue;
      if (!sameReceipt(current, target.before)) {
        throw new Error(`profile workspace settings target changed outside transaction: ${id}`);
      }
      const data = Buffer.from(target.data, 'base64');
      try {
        if (!atomicWritePrivateFile(
          paths[id],
          data,
          this.fileSystem,
          storageOptions(this.platform, this.windowsAcl),
        )) {
          throw new Error(`profile workspace settings target write failed: ${id}`);
        }
      } finally {
        data.fill(0);
      }
    }
    for (const id of TARGET_IDS) {
      if (!sameReceipt(this.#receipt(paths[id]), intent.targets[id].after)) {
        throw new Error(`profile workspace settings target verification failed: ${id}`);
      }
    }
    try {
      this.fileSystem.unlinkSync(paths.intent);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error('profile workspace settings transaction clear failed', { cause: error });
      }
    }
    if (!fsyncDirectory(path.dirname(paths.intent), this.fileSystem, this.platform)) {
      throw new Error('profile workspace settings transaction clear was not durable');
    }
  }

  #singleFlight(operation) {
    if (this.running) throw new Error('profile workspace settings transaction is already running');
    this.running = true;
    try {
      const value = operation();
      if (value && typeof value.then === 'function') {
        throw new TypeError('profile workspace settings transaction must be synchronous');
      }
      return value;
    } finally {
      this.running = false;
    }
  }

  #authority() {
    const authority = this.loadAuthority();
    if (authority && typeof authority.then === 'function') {
      throw new TypeError('active workspace authority loader must be synchronous');
    }
    bindingFromAuthority(authority);
    this.#paths(authority);
    return authority;
  }

  #paths(authority) {
    const layout = authority?.layout;
    const values = {
      globalSettings: layout?.global?.settings,
      globalUpdateState: layout?.global?.updateState,
      workspaceSettings: layout?.workspace?.settings,
      localResources: layout?.workspace?.localResources,
      intent: layout?.global?.settingsTransaction,
    };
    if (Object.values(values).some((file) => typeof file !== 'string' || !path.isAbsolute(file)) ||
        new Set(Object.values(values)).size !== Object.keys(values).length) {
      throw new TypeError('profile workspace settings paths are invalid');
    }
    return values;
  }

  #receipt(file) {
    return collectPrivateFileReceipt({
      file,
      maxBytes: MAX_SETTINGS_TARGET_BYTES,
      fileSystem: this.fileSystem,
      platform: this.platform,
      windowsAcl: this.windowsAcl,
      label: 'profile workspace settings target',
    });
  }

  #readIntent(file, expectedBinding) {
    try {
      this.fileSystem.lstatSync(file);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (this.platform === 'win32' && !this.windowsAcl.verify(file)) {
      throw new Error('profile workspace settings transaction ACL is invalid');
    }
    let data;
    try {
      ({ data } = readPrivateFileBounded(file, {
        maxBytes: MAX_SETTINGS_TRANSACTION_BYTES,
        minBytes: 2,
        platform: this.platform,
        fileSystem: this.fileSystem,
      }));
      return validateIntent(JSON.parse(data.toString('utf8')), expectedBinding);
    } finally {
      data?.fill(0);
    }
  }

  #writeIntent(file, intent) {
    const data = Buffer.from(`${JSON.stringify(intent)}\n`, 'utf8');
    try {
      if (data.length > MAX_SETTINGS_TRANSACTION_BYTES || !atomicWritePrivateFile(
        file,
        data,
        this.fileSystem,
        storageOptions(this.platform, this.windowsAcl),
      )) {
        throw new Error('profile workspace settings transaction write failed');
      }
    } finally {
      data.fill(0);
    }
  }
}

module.exports = {
  MAX_SETTINGS_TRANSACTION_BYTES,
  ProfileWorkspaceSettingsStore,
  SETTINGS_TRANSACTION_VERSION,
  TARGET_IDS,
};
