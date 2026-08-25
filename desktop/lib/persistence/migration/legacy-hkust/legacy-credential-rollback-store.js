'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('../../../credential-store');
const {
  retireLegacyCredentialRollbackState,
  validateLegacyCredentialRollbackState,
} = require('./legacy-credential-rollback-state');
const { readPrivateFileBounded } = require('../../../platform/storage/private-file');
const {
  normalizeGatewayOrigin,
  validateOpaqueKey,
  validateProfileId,
  validateProtocolFamily,
} = require('../../../profiles/schema/school-profile-schema');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('../../../platform/storage/windows-private-file');

const RETIREMENT_INTENT_VERSION = 1;
const MAX_ROLLBACK_BLOB_BYTES = 64 * 1024;
const MAX_ROLLBACK_DOCUMENT_BYTES = 64 * 1024;
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

function validateBinding(value) {
  const source = exactKeys(value, [
    'migrationId', 'profileId', 'profileCredentialBindingRevision', 'accountKey',
    'accountCredentialRevision', 'gatewayOrigin', 'protocolFamily',
  ], 'legacy rollback binding');
  return Object.freeze({
    migrationId: validateOpaqueKey(source.migrationId, 'migrationId'),
    profileId: validateProfileId(source.profileId),
    profileCredentialBindingRevision: positive(
      source.profileCredentialBindingRevision,
      'profileCredentialBindingRevision',
    ),
    accountKey: validateOpaqueKey(source.accountKey, 'accountKey'),
    accountCredentialRevision: positive(
      source.accountCredentialRevision,
      'accountCredentialRevision',
    ),
    gatewayOrigin: normalizeGatewayOrigin(source.gatewayOrigin).origin,
    protocolFamily: validateProtocolFamily(source.protocolFamily),
  });
}

function bindingFromState(state) {
  return {
    migrationId: state.migrationId,
    profileId: state.profileId,
    profileCredentialBindingRevision: state.profileCredentialBindingRevision,
    accountKey: state.accountKey,
    accountCredentialRevision: state.accountCredentialRevision,
    gatewayOrigin: state.gatewayOrigin,
    protocolFamily: state.protocolFamily,
  };
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stateDigest(state) {
  return crypto.createHash('sha256').update(JSON.stringify(state), 'utf8').digest('hex');
}

function assertBinding(state, expected) {
  if (!sameDocument(validateBinding(bindingFromState(state)), expected)) {
    throw new Error('legacy rollback binding does not match the active account');
  }
}

function validateRetirementIntent(value, expectedBinding) {
  const source = exactKeys(value, [
    'schemaVersion', 'type', 'activeStateSha256', 'retiredState', 'createdAt',
  ], 'legacy credential retirement intent');
  if (source.schemaVersion !== RETIREMENT_INTENT_VERSION ||
      source.type !== 'legacy_credential_retirement' ||
      (source.activeStateSha256 !== null &&
        (typeof source.activeStateSha256 !== 'string' || !DIGEST.test(source.activeStateSha256)))) {
    throw new TypeError('legacy credential retirement intent is unsupported');
  }
  const retiredState = validateLegacyCredentialRollbackState(source.retiredState);
  if (retiredState.state !== 'retired') {
    throw new TypeError('legacy credential retirement intent requires retired state');
  }
  assertBinding(retiredState, expectedBinding);
  return Object.freeze({
    schemaVersion: RETIREMENT_INTENT_VERSION,
    type: 'legacy_credential_retirement',
    activeStateSha256: source.activeStateSha256,
    retiredState,
    createdAt: positive(source.createdAt, 'createdAt'),
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

class LegacyCredentialRollbackStore {
  constructor({
    layout,
    expectedBinding,
    fileSystem = fs,
    platform = process.platform,
    windowsAcl = {
      protect: protectWindowsFileOwnerOnly,
      verify: verifyWindowsFileOwnerOnly,
    },
  } = {}) {
    if (!layout?.account || typeof layout.root !== 'string' ||
        typeof layout.account.root !== 'string' ||
        typeof layout.account.legacyCredentialRollbackBlob !== 'string' ||
        typeof layout.account.legacyCredentialRollbackState !== 'string' ||
        typeof layout.account.legacyCredentialRollbackRetirement !== 'string' ||
        !fileSystem || typeof fileSystem.openSync !== 'function' ||
        !['darwin', 'linux', 'win32'].includes(platform) ||
        (platform === 'win32' &&
          (typeof windowsAcl?.protect !== 'function' || typeof windowsAcl?.verify !== 'function'))) {
      throw new TypeError('legacy credential rollback store dependencies are invalid');
    }
    const files = [
      layout.account.legacyCredentialRollbackBlob,
      layout.account.legacyCredentialRollbackState,
      layout.account.legacyCredentialRollbackRetirement,
    ];
    if (!path.isAbsolute(layout.root) || path.resolve(layout.root) !== layout.root ||
        !path.isAbsolute(layout.account.root) || path.resolve(layout.account.root) !== layout.account.root ||
        path.relative(layout.root, layout.account.root).startsWith('..') ||
        files.some((file) => path.dirname(file) !== layout.account.root ||
          !path.isAbsolute(file) || path.resolve(file) !== file) ||
        new Set(files).size !== files.length) {
      throw new TypeError('legacy credential rollback paths are invalid');
    }
    this.root = layout.root;
    this.accountRoot = layout.account.root;
    this.blobPath = layout.account.legacyCredentialRollbackBlob;
    this.statePath = layout.account.legacyCredentialRollbackState;
    this.intentPath = layout.account.legacyCredentialRollbackRetirement;
    this.expectedBinding = validateBinding(expectedBinding);
    this.fileSystem = fileSystem;
    this.platform = platform;
    this.windowsAcl = windowsAcl;
  }

  inspect() {
    this.#verifyDirectoryChain();
    const state = this.#readState();
    const intent = this.#readIntent();
    const blobPresent = this.#pathPresent(this.blobPath);
    if (intent) {
      this.#validateIntentAgainstState(intent, state);
      if (blobPresent) this.#verifyBlob(state || intent.retiredState);
      return Object.freeze({ status: 'retirement_pending' });
    }
    if (!state) {
      if (blobPresent) throw new Error('legacy rollback blob exists without bound state');
      return Object.freeze({ status: 'none' });
    }
    assertBinding(state, this.expectedBinding);
    if (state.state === 'active') {
      if (!blobPresent) throw new Error('active rollback blob is missing');
      this.#verifyBlob(state);
      return Object.freeze({ status: 'active' });
    }
    if (blobPresent) {
      this.#verifyBlob(state);
      return Object.freeze({ status: 'retirement_pending' });
    }
    return Object.freeze({ status: 'retired' });
  }

  readActiveRollbackBlob() {
    this.#verifyDirectoryChain();
    if (this.#readIntent()) {
      throw new Error('legacy rollback retirement is pending');
    }
    const state = this.#readState();
    if (!state || state.state !== 'active') {
      throw new Error('active legacy rollback credential is unavailable');
    }
    assertBinding(state, this.expectedBinding);
    return this.#readAndVerifyBlob(state);
  }

  retire({ reason, now = Date.now } = {}) {
    const current = this.reconcile();
    if (current.status !== 'active') return current;
    const activeState = this.#readState();
    const retiredState = retireLegacyCredentialRollbackState(activeState, { reason, now });
    const intent = validateRetirementIntent({
      schemaVersion: RETIREMENT_INTENT_VERSION,
      type: 'legacy_credential_retirement',
      activeStateSha256: stateDigest(activeState),
      retiredState,
      createdAt: retiredState.retiredAt,
    }, this.expectedBinding);
    this.#writeDocument(this.intentPath, intent, 'retirement intent');
    return this.#resumeIntent(intent);
  }

  reconcile() {
    this.#verifyDirectoryChain();
    const intent = this.#readIntent();
    if (intent) return this.#resumeIntent(intent);
    const state = this.#readState();
    const blobPresent = this.#pathPresent(this.blobPath);
    if (!state) {
      if (blobPresent) throw new Error('legacy rollback blob exists without bound state');
      return Object.freeze({ status: 'none', changed: false });
    }
    assertBinding(state, this.expectedBinding);
    if (state.state === 'active') {
      if (!blobPresent) throw new Error('active rollback blob is missing');
      this.#verifyBlob(state);
      return Object.freeze({ status: 'active', changed: false });
    }
    if (!blobPresent) return Object.freeze({ status: 'retired', changed: false });
    this.#verifyBlob(state);
    const recoveryIntent = validateRetirementIntent({
      schemaVersion: RETIREMENT_INTENT_VERSION,
      type: 'legacy_credential_retirement',
      activeStateSha256: null,
      retiredState: state,
      createdAt: state.retiredAt,
    }, this.expectedBinding);
    this.#writeDocument(this.intentPath, recoveryIntent, 'retirement intent');
    return this.#resumeIntent(recoveryIntent);
  }

  retireBeforeMutation({ reason, mutation, now = Date.now } = {}) {
    if (typeof mutation !== 'function') {
      throw new TypeError('credential mutation must be a function');
    }
    this.retire({ reason, now });
    const result = mutation();
    if (result && typeof result.then === 'function') {
      throw new TypeError('credential mutation must be synchronous');
    }
    return result;
  }

  #resumeIntent(intent) {
    const state = this.#readState();
    this.#validateIntentAgainstState(intent, state);
    if (this.#pathPresent(this.blobPath)) {
      this.#verifyBlob(state || intent.retiredState);
      try {
        this.fileSystem.unlinkSync(this.blobPath);
      } catch (error) {
        throw new Error('legacy rollback blob removal failed', { cause: error });
      }
      if (!fsyncDirectory(this.accountRoot, this.fileSystem, this.platform)) {
        throw new Error('legacy rollback blob removal failed: directory fsync');
      }
    }
    const committedState = this.#readState();
    if (!committedState || !sameDocument(committedState, intent.retiredState)) {
      try {
        this.#writeDocument(this.statePath, intent.retiredState, 'state');
      } catch (error) {
        throw new Error('legacy rollback state commit failed', { cause: error });
      }
    }
    const verifiedState = this.#readState();
    if (!verifiedState || !sameDocument(verifiedState, intent.retiredState)) {
      throw new Error('legacy rollback state commit failed verification');
    }
    try {
      this.fileSystem.unlinkSync(this.intentPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error('legacy rollback retirement intent clear failed', { cause: error });
      }
    }
    if (!fsyncDirectory(this.accountRoot, this.fileSystem, this.platform)) {
      throw new Error('legacy rollback retirement intent clear failed: directory fsync');
    }
    return Object.freeze({ status: 'retired', changed: true });
  }

  #validateIntentAgainstState(intent, state) {
    if (!state) throw new Error('legacy rollback retirement intent has no bound state');
    assertBinding(state, this.expectedBinding);
    if (state.state === 'active') {
      if (!intent.activeStateSha256 || stateDigest(state) !== intent.activeStateSha256) {
        throw new Error('legacy rollback retirement intent binding is stale');
      }
      return;
    }
    if (!sameDocument(state, intent.retiredState)) {
      throw new Error('legacy rollback retired state conflicts with retirement intent');
    }
  }

  #verifyDirectoryChain() {
    const relative = path.relative(this.root, this.accountRoot);
    let current = this.root;
    for (const component of ['', ...relative.split(path.sep).filter(Boolean)]) {
      if (component) current = path.join(current, component);
      let stat;
      try {
        stat = this.fileSystem.lstatSync(current);
      } catch (error) {
        throw new Error('legacy rollback account directory is unavailable', { cause: error });
      }
      if (!stat.isDirectory() || stat.isSymbolicLink() ||
          (this.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
        throw new Error('legacy rollback account directory is not owner-only and link-free');
      }
    }
  }

  #pathPresent(file) {
    try {
      this.fileSystem.lstatSync(file);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  #readDocument(file, label, validator) {
    if (!this.#pathPresent(file)) return null;
    if (this.platform === 'win32' && !this.windowsAcl.verify(file)) {
      throw new Error(`invalid private file: ${label}`);
    }
    let data = null;
    try {
      data = readPrivateFileBounded(file, {
        maxBytes: MAX_ROLLBACK_DOCUMENT_BYTES,
        minBytes: 2,
        platform: this.platform,
        fileSystem: this.fileSystem,
      }).data;
      return validator(JSON.parse(data.toString('utf8')));
    } catch (error) {
      if (error?.privateFileInvalid === true) throw new Error(`invalid private file: ${label}`, {
        cause: error,
      });
      throw error;
    } finally {
      data?.fill(0);
    }
  }

  #readState() {
    const state = this.#readDocument(
      this.statePath,
      'legacy rollback state',
      validateLegacyCredentialRollbackState,
    );
    if (state) assertBinding(state, this.expectedBinding);
    return state;
  }

  #readIntent() {
    return this.#readDocument(
      this.intentPath,
      'legacy rollback retirement intent',
      (value) => validateRetirementIntent(value, this.expectedBinding),
    );
  }

  #readAndVerifyBlob(state) {
    if (this.platform === 'win32' && !this.windowsAcl.verify(this.blobPath)) {
      throw new Error('invalid private file: legacy rollback blob');
    }
    let data;
    try {
      data = readPrivateFileBounded(this.blobPath, {
        maxBytes: MAX_ROLLBACK_BLOB_BYTES,
        platform: this.platform,
        fileSystem: this.fileSystem,
      }).data;
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('active rollback blob is missing', {
        cause: error,
      });
      if (error?.privateFileInvalid === true) throw new Error(
        'invalid private file: legacy rollback blob',
        { cause: error },
      );
      throw error;
    }
    const digest = crypto.createHash('sha256').update(data).digest('hex');
    if (state.sourceBytes !== data.length || state.sourceSha256 !== digest) {
      data.fill(0);
      throw new Error('legacy rollback blob does not match its bound receipt');
    }
    return data;
  }

  #verifyBlob(state) {
    const data = this.#readAndVerifyBlob(state);
    data.fill(0);
  }

  #writeDocument(file, value, label) {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
    if (bytes.length > MAX_ROLLBACK_DOCUMENT_BYTES || !atomicWritePrivateFile(
      file,
      bytes,
      this.fileSystem,
      storageOptions(this.platform, this.windowsAcl),
    )) {
      bytes.fill(0);
      throw new Error(`legacy rollback ${label} write failed`);
    }
    bytes.fill(0);
  }
}

function createLegacyCredentialRollbackStoreForAuthority({
  authority,
  fileSystem = fs,
  platform = process.platform,
  windowsAcl = {
    protect: protectWindowsFileOwnerOnly,
    verify: verifyWindowsFileOwnerOnly,
  },
} = {}) {
  const layout = authority?.layout;
  const statePath = layout?.account?.legacyCredentialRollbackState;
  if (typeof statePath !== 'string' || !authority?.profileState || !authority?.account ||
      (platform === 'win32' && !windowsAcl?.verify?.(statePath))) {
    throw new TypeError('legacy rollback authority is incomplete');
  }
  let data;
  let state;
  try {
    ({ data } = readPrivateFileBounded(statePath, {
      maxBytes: MAX_ROLLBACK_DOCUMENT_BYTES,
      minBytes: 2,
      platform,
      fileSystem,
    }));
    state = validateLegacyCredentialRollbackState(JSON.parse(data.toString('utf8')));
  } finally {
    data?.fill(0);
  }
  const accountOrigin = authority.account.gatewayOrigin?.origin;
  if (state.migrationId !== authority.profileState.migrationId ||
      state.profileId !== authority.profile.profileId ||
      state.profileCredentialBindingRevision !==
        authority.profileState.profileCredentialBindingRevision ||
      state.accountKey !== authority.account.accountKey ||
      state.accountCredentialRevision > authority.account.accountCredentialRevision ||
      state.gatewayOrigin !== accountOrigin ||
      state.protocolFamily !== authority.account.protocolFamily) {
    throw new Error('legacy rollback metadata does not match runtime authority');
  }
  return new LegacyCredentialRollbackStore({
    layout,
    expectedBinding: bindingFromState(state),
    fileSystem,
    platform,
    windowsAcl,
  });
}

module.exports = {
  createLegacyCredentialRollbackStoreForAuthority,
  LegacyCredentialRollbackStore,
  RETIREMENT_INTENT_VERSION,
};
