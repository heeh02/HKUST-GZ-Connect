'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('../../platform/storage/atomic-private-file');
const { readPrivateFileBounded } = require('../../platform/storage/private-file');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('../../platform/storage/windows-private-file');
const { validateResourceId } = require('../schema/resource-activity-contract');

const MAX_GROUPS = 16;
const MAX_GROUP_NAME = 30;
const MAX_GROUP_BYTES = 32 * 1024;
const GROUP_ID = /^group_[a-z0-9_-]{12,64}$/u;

function validateGroupDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'groups,schemaVersion' ||
      value.schemaVersion !== 1 || !Array.isArray(value.groups) || value.groups.length > MAX_GROUPS) {
    throw new TypeError('favorite group document is invalid');
  }
  const groupIds = new Set();
  const resourceIds = new Set();
  const groups = value.groups.map((group) => {
    if (!group || typeof group !== 'object' || Array.isArray(group) ||
        Object.keys(group).sort().join(',') !== 'id,name,resourceIds' ||
        typeof group.id !== 'string' || !GROUP_ID.test(group.id) || groupIds.has(group.id) ||
        typeof group.name !== 'string' || !group.name.trim() || group.name.length > MAX_GROUP_NAME ||
        /[\u0000-\u001f\u007f<>]/u.test(group.name) || !Array.isArray(group.resourceIds) ||
        group.resourceIds.length > 64 || new Set(group.resourceIds).size !== group.resourceIds.length) {
      throw new TypeError('favorite group is invalid');
    }
    const ids = group.resourceIds.map((id) => validateResourceId(id));
    if (ids.some((id) => resourceIds.has(id))) {
      throw new TypeError('favorite resource belongs to multiple groups');
    }
    groupIds.add(group.id);
    for (const id of ids) resourceIds.add(id);
    return Object.freeze({ id: group.id, name: group.name.trim(), resourceIds: Object.freeze(ids) });
  });
  return Object.freeze({ schemaVersion: 1, groups: Object.freeze(groups) });
}

function emptyGroupDocument() {
  return validateGroupDocument({ schemaVersion: 1, groups: [] });
}

function storageOptions(platform, windowsAcl) {
  return platform === 'win32' ? {
    protectTemporary: (file) => windowsAcl.protect(file) === true,
    verifyCommitted: (file) => windowsAcl.verify(file) === true,
    removeCommittedOnFailure: true,
  } : {};
}

class FavoriteGroupStore {
  constructor({
    filePath,
    fileSystem = fs,
    platform = process.platform,
    windowsAcl = { protect: protectWindowsFileOwnerOnly, verify: verifyWindowsFileOwnerOnly },
    randomBytes = crypto.randomBytes,
  } = {}) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.resolve(filePath) !== filePath ||
        !fileSystem || typeof fileSystem.openSync !== 'function' ||
        !['darwin', 'linux', 'win32'].includes(platform) || typeof randomBytes !== 'function' ||
        (platform === 'win32' && (typeof windowsAcl?.protect !== 'function' ||
         typeof windowsAcl?.verify !== 'function'))) {
      throw new TypeError('favorite group store dependencies are invalid');
    }
    Object.assign(this, { filePath, fileSystem, platform, windowsAcl, randomBytes });
  }

  snapshot() { return this.#read(); }

  replace(document) {
    const next = validateGroupDocument(document);
    this.#write(next);
    return next;
  }

  create(name) {
    const current = this.#read();
    if (current.groups.length >= MAX_GROUPS) throw new Error('favorite group limit reached');
    const clean = String(name || '').trim();
    if (!clean || clean.length > MAX_GROUP_NAME || /[\u0000-\u001f\u007f<>]/u.test(clean)) {
      throw new TypeError('favorite group name is invalid');
    }
    let id;
    do { id = `group_${this.randomBytes(12).toString('hex')}`; }
    while (current.groups.some((group) => group.id === id));
    return this.replace({
      schemaVersion: 1,
      groups: [...current.groups, { id, name: clean, resourceIds: [] }],
    });
  }

  rename(groupId, name) {
    const current = this.#read();
    if (!current.groups.some(({ id }) => id === groupId)) throw new Error('favorite group is unavailable');
    return this.replace({ schemaVersion: 1, groups: current.groups.map((group) => (
      group.id === groupId ? { ...group, name: String(name || '').trim() } : group
    )) });
  }

  remove(groupId) {
    const current = this.#read();
    if (!current.groups.some(({ id }) => id === groupId)) throw new Error('favorite group is unavailable');
    return this.replace({
      schemaVersion: 1,
      groups: current.groups.filter(({ id }) => id !== groupId),
    });
  }

  reorder(groupIds) {
    const current = this.#read();
    if (!Array.isArray(groupIds) || groupIds.length !== current.groups.length ||
        new Set(groupIds).size !== groupIds.length) throw new Error('favorite group order is invalid');
    const byId = new Map(current.groups.map((group) => [group.id, group]));
    if (groupIds.some((id) => !byId.has(id))) throw new Error('favorite group order is stale');
    return this.replace({ schemaVersion: 1, groups: groupIds.map((id) => byId.get(id)) });
  }

  move(resourceId, groupId, index, favoriteIds) {
    const resource = validateResourceId(resourceId);
    const favorites = new Set(favoriteIds.map((id) => validateResourceId(id)));
    if (!favorites.has(resource)) throw new Error('only favorite resources can be grouped');
    const current = this.#read();
    if (groupId !== null && !current.groups.some(({ id }) => id === groupId)) {
      throw new Error('favorite group is unavailable');
    }
    const groups = current.groups.map((group) => ({
      ...group,
      resourceIds: group.resourceIds.filter((id) => id !== resource),
    }));
    if (groupId !== null) {
      const target = groups.find(({ id }) => id === groupId);
      target.resourceIds.splice(Math.min(index, target.resourceIds.length), 0, resource);
    }
    return this.replace({ schemaVersion: 1, groups });
  }

  removeResource(resourceId) {
    const current = this.#read();
    if (!current.groups.some(({ resourceIds }) => resourceIds.includes(resourceId))) return current;
    return this.replace({ schemaVersion: 1, groups: current.groups.map((group) => ({
      ...group,
      resourceIds: group.resourceIds.filter((id) => id !== resourceId),
    })) });
  }

  #read() {
    try { this.fileSystem.lstatSync(this.filePath); }
    catch (error) { if (error?.code === 'ENOENT') return emptyGroupDocument(); throw error; }
    if (this.platform === 'win32' && !this.windowsAcl.verify(this.filePath)) {
      throw new Error('favorite group ACL is invalid');
    }
    let data;
    try {
      ({ data } = readPrivateFileBounded(this.filePath, {
        maxBytes: MAX_GROUP_BYTES, minBytes: 2, platform: this.platform,
        fileSystem: this.fileSystem,
      }));
      return validateGroupDocument(JSON.parse(data.toString('utf8')));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('favorite group document is invalid', { cause: error });
      throw error;
    } finally { data?.fill(0); }
  }

  #write(document) {
    const data = Buffer.from(`${JSON.stringify(document)}\n`, 'utf8');
    try {
      if (data.length > MAX_GROUP_BYTES || !atomicWritePrivateFile(
        this.filePath, data, this.fileSystem, storageOptions(this.platform, this.windowsAcl),
      )) throw new Error('favorite group write failed');
    } finally { data.fill(0); }
  }
}

module.exports = {
  FavoriteGroupStore,
  MAX_GROUPS,
  emptyGroupDocument,
  validateGroupDocument,
};
