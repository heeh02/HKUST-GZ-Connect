'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile, fsyncDirectory } = require('../../platform/storage/atomic-private-file');
const { ensurePrivateDirectoryChain, verifyPrivateDirectoryChain } = require('../../platform/storage/private-directory');
const { readPrivateFileBounded } = require('../../platform/storage/private-file');
const { protectWindowsFileOwnerOnly, verifyWindowsFileOwnerOnly } = require('../../platform/storage/windows-private-file');

const TOMBSTONE_VERSION = 1;
const MAX_TOMBSTONE_BYTES = 16 * 1024;
const STATES = new Set(['prepared', 'browser-cleared']);
const PROFILE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const OPAQUE_KEY = /^[a-z0-9][a-z0-9_-]{20,62}[a-z0-9]$/u;

function validateProfileId(value) {
  if (typeof value !== 'string' || !PROFILE_ID.test(value)) throw new TypeError('profileId is invalid');
  return value;
}

function validateOpaqueKey(value, name) {
  if (typeof value !== 'string' || !OPAQUE_KEY.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function tombstoneDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'accountKey', 'browserPartition', 'createdAt', 'profileId', 'profileKey',
        'schemaVersion', 'state', 'workspaceKey',
      ].sort()) || value.schemaVersion !== TOMBSTONE_VERSION || !STATES.has(value.state) ||
      !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0 ||
      typeof value.browserPartition !== 'string' ||
      !/^persist:campus-workspace-[a-z0-9-]{1,64}$/u.test(value.browserPartition)) {
    throw new TypeError('custom Profile deletion tombstone is invalid');
  }
  const profileId = validateProfileId(value.profileId);
  if (!profileId.startsWith('custom-')) throw new TypeError('custom Profile deletion identity is invalid');
  return Object.freeze({
    schemaVersion: TOMBSTONE_VERSION,
    profileId,
    profileKey: validateOpaqueKey(value.profileKey, 'deletion profileKey'),
    accountKey: validateOpaqueKey(value.accountKey, 'deletion accountKey'),
    workspaceKey: validateOpaqueKey(value.workspaceKey, 'deletion workspaceKey'),
    browserPartition: value.browserPartition,
    state: value.state,
    createdAt: value.createdAt,
  });
}

function tombstoneBytes(value) {
  const bytes = Buffer.from(`${JSON.stringify(tombstoneDocument(value))}\n`, 'utf8');
  if (bytes.length > MAX_TOMBSTONE_BYTES) {
    bytes.fill(0);
    throw new TypeError('custom Profile deletion tombstone exceeds its bound');
  }
  return bytes;
}

function quarantineRoot(userData, profileKey) {
  return path.join(userData, 'profiles', `.deleting-${validateOpaqueKey(profileKey, 'profileKey')}`);
}

function tombstoneCandidates(root, fileSystem = fs) {
  const accounts = path.join(root, 'accounts');
  let entries;
  try { entries = fileSystem.readdirSync(accounts, { withFileTypes: true }); }
  catch (error) { return error?.code === 'ENOENT' ? [] : (() => { throw error; })(); }
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(accounts, entry.name, 'deletion-tombstone.json'))
    .filter((file) => {
      try { return fileSystem.lstatSync(file).isFile(); } catch { return false; }
    });
}

class CustomProfileDeletionRuntime {
  constructor({
    userData,
    withCandidateDirectory,
    electronSession,
    fileSystem = fs,
    platform = process.platform,
    windowsAcl = { protect: protectWindowsFileOwnerOnly, verify: verifyWindowsFileOwnerOnly },
    now = Date.now,
  } = {}) {
    if (typeof userData !== 'string' || !path.isAbsolute(userData) || path.resolve(userData) !== userData ||
        typeof withCandidateDirectory !== 'function' || !electronSession ||
        typeof electronSession.fromPartition !== 'function' || !fileSystem ||
        !['darwin', 'linux', 'win32'].includes(platform) || typeof now !== 'function') {
      throw new TypeError('custom Profile deletion dependencies are invalid');
    }
    Object.assign(this, { userData, withCandidateDirectory, electronSession, fileSystem, platform, windowsAcl, now });
    this.inFlight = null;
  }

  deleteProfile({ profileId, activeProfileId } = {}) {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.#delete(profileId, activeProfileId).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  recover() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.#recover().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async #delete(rawProfileId, rawActiveProfileId) {
    const profileId = validateProfileId(rawProfileId);
    const activeProfileId = validateProfileId(rawActiveProfileId);
    if (!profileId.startsWith('custom-') || profileId === activeProfileId) {
      return { ok: false, code: 'PROFILE_DELETE_NOT_ALLOWED' };
    }
    try {
      return await this.withCandidateDirectory(async (directory) => {
        let record;
        directory.withCandidate(profileId, (value) => { record = value; });
        if (!record || record.kind !== 'custom-local') {
          return { ok: false, code: 'PROFILE_DELETE_NOT_ALLOWED' };
        }
        const indexTransition = directory.customRegistry.indexStore.planRemove(profileId);
        const layout = record.authority.layout;
        const document = tombstoneDocument({
          schemaVersion: TOMBSTONE_VERSION,
          profileId,
          profileKey: record.context.profileKey,
          accountKey: record.context.accountKey,
          workspaceKey: record.context.workspaceKey,
          browserPartition: layout.browserPartition,
          state: 'prepared',
          createdAt: this.now(),
        });
        this.#writeTombstone(layout.account.deletionTombstone, document);
        await this.#clearBrowser(document.browserPartition);
        this.#writeTombstone(layout.account.deletionTombstone, { ...document, state: 'browser-cleared' });
        const quarantined = this.#quarantine(layout.profile.root, document.profileKey);
        if (!directory.customRegistry.indexStore.applyRemove(profileId, indexTransition)) {
          throw new Error('custom Profile index deletion was not durable');
        }
        this.#removeQuarantine(quarantined);
        directory.customRegistry.reload();
        return { ok: true, profileId };
      });
    } catch {
      return { ok: false, code: 'PROFILE_DELETE_INCOMPLETE' };
    }
  }

  async #recover() {
    try {
      return await this.withCandidateDirectory(async (directory) => {
        const index = directory.customRegistry.indexStore.read();
        let recovered = 0;
        for (const entry of index.entries) {
          const normal = path.join(this.userData, 'profiles', entry.profileKey);
          const quarantine = quarantineRoot(this.userData, entry.profileKey);
          const root = this.#directoryExists(quarantine) ? quarantine : normal;
          const files = tombstoneCandidates(root, this.fileSystem);
          if (files.length !== 1) continue;
          const document = this.#readTombstone(files[0]);
          if (document.profileId !== entry.profileId || document.profileKey !== entry.profileKey) {
            throw new Error('custom Profile deletion tombstone identity drifted');
          }
          await this.#clearBrowser(document.browserPartition);
          const quarantined = root === quarantine ? quarantine : this.#quarantine(normal, entry.profileKey);
          const transition = directory.customRegistry.indexStore.planRemove(entry.profileId);
          if (!directory.customRegistry.indexStore.applyRemove(entry.profileId, transition)) {
            throw new Error('custom Profile deletion recovery did not retire the index');
          }
          this.#removeQuarantine(quarantined);
          recovered += 1;
        }
        this.#removeRetiredQuarantines();
        directory.customRegistry.reload();
        return { ok: true, recovered };
      });
    } catch {
      return { ok: false, code: 'PROFILE_DELETE_INCOMPLETE' };
    }
  }

  #writeTombstone(file, value) {
    ensurePrivateDirectoryChain(this.userData, path.dirname(file), {
      fileSystem: this.fileSystem,
      platform: this.platform,
    });
    const bytes = tombstoneBytes(value);
    try {
      const options = this.platform === 'win32' ? {
        protectTemporary: (target) => this.windowsAcl.protect(target) === true,
        verifyCommitted: (target) => this.windowsAcl.verify(target) === true,
        removeCommittedOnFailure: true,
      } : {};
      if (!atomicWritePrivateFile(file, bytes, this.fileSystem, options)) {
        throw new Error('custom Profile deletion tombstone write failed');
      }
    } finally { bytes.fill(0); }
  }

  #readTombstone(file) {
    const { data } = readPrivateFileBounded(file, {
      maxBytes: MAX_TOMBSTONE_BYTES,
      minBytes: 2,
      platform: this.platform,
      fileSystem: this.fileSystem,
    });
    try { return tombstoneDocument(JSON.parse(data.toString('utf8'))); }
    finally { data.fill(0); }
  }

  async #clearBrowser(partition) {
    const target = this.electronSession.fromPartition(partition);
    await target.closeAllConnections?.();
    await target.clearStorageData?.();
    await target.clearCache?.();
  }

  #quarantine(root, profileKey) {
    verifyPrivateDirectoryChain(this.userData, root, {
      fileSystem: this.fileSystem,
      platform: this.platform,
    });
    const target = quarantineRoot(this.userData, profileKey);
    if (this.#directoryExists(target)) return target;
    this.fileSystem.renameSync(root, target);
    if (!fsyncDirectory(path.dirname(root), this.fileSystem)) {
      throw new Error('custom Profile quarantine rename was not durable');
    }
    return target;
  }

  #removeQuarantine(root) {
    verifyPrivateDirectoryChain(this.userData, root, {
      fileSystem: this.fileSystem,
      platform: this.platform,
    });
    this.fileSystem.rmSync(root, { recursive: true, force: false });
    if (!fsyncDirectory(path.dirname(root), this.fileSystem)) {
      throw new Error('custom Profile namespace deletion was not durable');
    }
  }

  #removeRetiredQuarantines() {
    const profiles = path.join(this.userData, 'profiles');
    let entries;
    try { entries = this.fileSystem.readdirSync(profiles, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith('.deleting-')) continue;
      const root = path.join(profiles, entry.name);
      if (tombstoneCandidates(root, this.fileSystem).length === 1) this.#removeQuarantine(root);
    }
  }

  #directoryExists(root) {
    try { return this.fileSystem.lstatSync(root).isDirectory(); }
    catch { return false; }
  }
}

module.exports = {
  CustomProfileDeletionRuntime,
  customProfileDeletionTombstone: tombstoneDocument,
  customProfileQuarantineRoot: quarantineRoot,
  findCustomProfileDeletionTombstones: tombstoneCandidates,
};
