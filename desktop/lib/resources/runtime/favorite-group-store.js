'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('../../platform/storage/atomic-private-file');
const { readPrivateFileBounded } = require('../../platform/storage/private-file');
const { protectWindowsFileOwnerOnly, verifyWindowsFileOwnerOnly } = require('../../platform/storage/windows-private-file');
const { validateResourceId } = require('../schema/resource-activity-contract');

const MAX_GROUPS = 16;
const MAX_GROUP_NAME = 30;
const MAX_PLACEMENTS = 256;
const MAX_GROUP_BYTES = 64 * 1024;
const GROUP_ID = /^group_[a-z0-9_-]{12,64}$/u;
const validTime = (value) => Number.isSafeInteger(value) && value > 0;

function migrateLegacyDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 ||
      Object.keys(value).sort().join(',') !== 'groups,schemaVersion' ||
      !Array.isArray(value.groups) || value.groups.length > MAX_GROUPS) {
    throw new TypeError('favorite collection document is invalid');
  }
  const groupIds = new Set();
  const assigned = new Set();
  const collections = [];
  const placements = [];
  for (const group of value.groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group) ||
        Object.keys(group).sort().join(',') !== 'id,name,resourceIds' ||
        !GROUP_ID.test(group.id) || groupIds.has(group.id) || typeof group.name !== 'string' ||
        !group.name.trim() || group.name.length > MAX_GROUP_NAME ||
        /[\u0000-\u001f\u007f<>]/u.test(group.name) || !Array.isArray(group.resourceIds) ||
        group.resourceIds.length > 64 || new Set(group.resourceIds).size !== group.resourceIds.length) {
      throw new TypeError('favorite collection document is invalid');
    }
    groupIds.add(group.id);
    collections.push({ id: group.id, name: group.name.trim(), createdAt: 1, updatedAt: 1 });
    group.resourceIds.map(validateResourceId).forEach((resourceId, order) => {
      if (assigned.has(resourceId)) throw new TypeError('legacy favorite resource belongs to multiple groups');
      assigned.add(resourceId);
      placements.push({ collectionId: group.id, resourceId, order, pinned: false });
    });
  }
  return { schemaVersion: 2, collections, placements };
}

function validateGroupDocument(input) {
  const value = input?.schemaVersion === 1 ? migrateLegacyDocument(input) : input;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'collections,placements,schemaVersion' ||
      value.schemaVersion !== 2 || !Array.isArray(value.collections) ||
      value.collections.length > MAX_GROUPS || !Array.isArray(value.placements) ||
      value.placements.length > MAX_PLACEMENTS) {
    throw new TypeError('favorite collection document is invalid');
  }
  const ids = new Set();
  const collections = value.collections.map((collection) => {
    if (!collection || typeof collection !== 'object' || Array.isArray(collection) ||
        Object.keys(collection).sort().join(',') !== 'createdAt,id,name,updatedAt' ||
        !GROUP_ID.test(collection.id) || ids.has(collection.id) ||
        typeof collection.name !== 'string' || !collection.name.trim() ||
        collection.name.length > MAX_GROUP_NAME || /[\u0000-\u001f\u007f<>]/u.test(collection.name) ||
        !validTime(collection.createdAt) || !validTime(collection.updatedAt) ||
        collection.updatedAt < collection.createdAt) throw new TypeError('favorite collection is invalid');
    ids.add(collection.id);
    return Object.freeze({ id: collection.id, name: collection.name.trim(),
      createdAt: collection.createdAt, updatedAt: collection.updatedAt });
  });
  const pairs = new Set();
  const orders = new Map(collections.map(({ id }) => [id, new Set()]));
  const placements = value.placements.map((placement) => {
    if (!placement || typeof placement !== 'object' || Array.isArray(placement) ||
        Object.keys(placement).sort().join(',') !== 'collectionId,order,pinned,resourceId' ||
        !ids.has(placement.collectionId) || !Number.isSafeInteger(placement.order) ||
        placement.order < 0 || placement.order > 64 || typeof placement.pinned !== 'boolean') {
      throw new TypeError('favorite placement is invalid');
    }
    const resourceId = validateResourceId(placement.resourceId);
    const pair = `${placement.collectionId}\0${resourceId}`;
    if (pairs.has(pair) || orders.get(placement.collectionId).has(placement.order)) {
      throw new TypeError('favorite placement is duplicated');
    }
    pairs.add(pair); orders.get(placement.collectionId).add(placement.order);
    return Object.freeze({ collectionId: placement.collectionId, resourceId,
      order: placement.order, pinned: placement.pinned });
  });
  for (const collection of collections) {
    const sequence = placements.filter(({ collectionId }) => collectionId === collection.id)
      .map(({ order }) => order).sort((a, b) => a - b);
    if (sequence.some((order, index) => order !== index)) {
      throw new TypeError('favorite placement order is not canonical');
    }
  }
  return Object.freeze({ schemaVersion: 2, collections: Object.freeze(collections),
    placements: Object.freeze(placements) });
}

const emptyGroupDocument = () => validateGroupDocument({ schemaVersion: 2, collections: [], placements: [] });

function groupProjection(document) {
  const source = validateGroupDocument(document);
  return Object.freeze(source.collections.map(({ id, name }) => Object.freeze({ id, name,
    resourceIds: Object.freeze(source.placements.filter(({ collectionId }) => collectionId === id)
      .sort((a, b) => a.order - b.order).map(({ resourceId }) => resourceId)),
  })));
}

function compactPlacements(placements, collections) {
  return collections.flatMap(({ id: collectionId }) => placements
    .filter((placement) => placement.collectionId === collectionId)
    .sort((a, b) => a.order - b.order)
    .map((placement, order) => ({ ...placement, order })));
}

function storageOptions(platform, windowsAcl) {
  return platform === 'win32' ? {
    protectTemporary: (file) => windowsAcl.protect(file) === true,
    verifyCommitted: (file) => windowsAcl.verify(file) === true,
    removeCommittedOnFailure: true,
  } : {};
}

class FavoriteGroupStore {
  constructor({ filePath, fileSystem = fs, platform = process.platform,
    windowsAcl = { protect: protectWindowsFileOwnerOnly, verify: verifyWindowsFileOwnerOnly },
    randomBytes = crypto.randomBytes, now = Date.now } = {}) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.resolve(filePath) !== filePath ||
        !fileSystem || typeof fileSystem.openSync !== 'function' ||
        !['darwin', 'linux', 'win32'].includes(platform) || typeof randomBytes !== 'function' ||
        typeof now !== 'function' || (platform === 'win32' && (typeof windowsAcl?.protect !== 'function' ||
         typeof windowsAcl?.verify !== 'function'))) {
      throw new TypeError('favorite collection store dependencies are invalid');
    }
    Object.assign(this, { filePath, fileSystem, platform, windowsAcl, randomBytes, now });
  }

  snapshot() { return this.#read(); }
  groups() { return groupProjection(this.#read()); }
  replace(document) { const next = validateGroupDocument(document); this.#write(next); return next; }

  create(name) {
    const current = this.#read();
    if (current.collections.length >= MAX_GROUPS) throw new Error('favorite collection limit reached');
    const clean = String(name || '').trim();
    if (!clean || clean.length > MAX_GROUP_NAME || /[\u0000-\u001f\u007f<>]/u.test(clean)) {
      throw new TypeError('favorite collection name is invalid');
    }
    let id;
    do { id = `group_${this.randomBytes(12).toString('hex')}`; }
    while (current.collections.some((collection) => collection.id === id));
    const timestamp = this.now();
    return this.replace({ ...current, collections: [...current.collections,
      { id, name: clean, createdAt: timestamp, updatedAt: timestamp }] });
  }

  rename(collectionId, name) {
    const current = this.#read();
    if (!current.collections.some(({ id }) => id === collectionId)) throw new Error('favorite collection is unavailable');
    return this.replace({ ...current, collections: current.collections.map((collection) => (
      collection.id === collectionId ? { ...collection, name: String(name || '').trim(), updatedAt: this.now() } : collection
    )) });
  }

  remove(collectionId) {
    const current = this.#read();
    if (!current.collections.some(({ id }) => id === collectionId)) throw new Error('favorite collection is unavailable');
    return this.replace({ ...current,
      collections: current.collections.filter(({ id }) => id !== collectionId),
      placements: current.placements.filter(({ collectionId: id }) => id !== collectionId) });
  }

  reorder(collectionIds) {
    const current = this.#read();
    if (!Array.isArray(collectionIds) || collectionIds.length !== current.collections.length ||
        new Set(collectionIds).size !== collectionIds.length) throw new Error('favorite collection order is invalid');
    const byId = new Map(current.collections.map((collection) => [collection.id, collection]));
    if (collectionIds.some((id) => !byId.has(id))) throw new Error('favorite collection order is stale');
    return this.replace({ ...current, collections: collectionIds.map((id) => byId.get(id)) });
  }

  move(resourceId, collectionId, index, favoriteIds) {
    const resource = validateResourceId(resourceId);
    const favorites = new Set(favoriteIds.map(validateResourceId));
    if (!favorites.has(resource)) throw new Error('only favorite resources can be grouped');
    const current = this.#read();
    if (collectionId !== null && !current.collections.some(({ id }) => id === collectionId)) {
      throw new Error('favorite collection is unavailable');
    }
    let placements = current.placements.filter(({ resourceId: id }) => id !== resource);
    if (collectionId !== null) {
      const target = placements.filter(({ collectionId: id }) => id === collectionId)
        .sort((a, b) => a.order - b.order);
      target.splice(Math.min(index, target.length), 0,
        { collectionId, resourceId: resource, order: index, pinned: false });
      placements = [
        ...placements.filter(({ collectionId: id }) => id !== collectionId),
        ...target,
      ];
    }
    placements = compactPlacements(placements, current.collections);
    return this.replace({ ...current, placements });
  }

  addMany(resourceIds, collectionId, favoriteIds) {
    const resources = [...new Set(resourceIds.map(validateResourceId))];
    const favorites = new Set(favoriteIds.map(validateResourceId));
    if (!resources.length || resources.some((id) => !favorites.has(id))) {
      throw new Error('only favorite resources can be grouped');
    }
    const current = this.#read();
    if (!current.collections.some(({ id }) => id === collectionId)) throw new Error('favorite collection is unavailable');
    const placements = current.placements.map((placement) => ({ ...placement }));
    let order = placements.filter(({ collectionId: id }) => id === collectionId).length;
    for (const resourceId of resources) {
      if (!placements.some((placement) => placement.collectionId === collectionId &&
          placement.resourceId === resourceId)) placements.push({ collectionId, resourceId, order: order++, pinned: false });
    }
    return this.replace({ ...current, placements });
  }

  removeResource(resourceId) {
    const resource = validateResourceId(resourceId);
    const current = this.#read();
    if (!current.placements.some(({ resourceId: id }) => id === resource)) return current;
    return this.replace({ ...current, placements: compactPlacements(
      current.placements.filter(({ resourceId: id }) => id !== resource), current.collections) });
  }

  #read() {
    try { this.fileSystem.lstatSync(this.filePath); }
    catch (error) { if (error?.code === 'ENOENT') return emptyGroupDocument(); throw error; }
    if (this.platform === 'win32' && !this.windowsAcl.verify(this.filePath)) {
      throw new Error('favorite collection ACL is invalid');
    }
    let data;
    try {
      ({ data } = readPrivateFileBounded(this.filePath, { maxBytes: MAX_GROUP_BYTES, minBytes: 2,
        platform: this.platform, fileSystem: this.fileSystem }));
      return validateGroupDocument(JSON.parse(data.toString('utf8')));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('favorite collection document is invalid', { cause: error });
      throw error;
    } finally { data?.fill(0); }
  }

  #write(document) {
    const data = Buffer.from(`${JSON.stringify(document)}\n`, 'utf8');
    try {
      if (data.length > MAX_GROUP_BYTES || !atomicWritePrivateFile(
        this.filePath, data, this.fileSystem, storageOptions(this.platform, this.windowsAcl),
      )) throw new Error('favorite collection write failed');
    } finally { data.fill(0); }
  }
}

module.exports = { FavoriteGroupStore, MAX_GROUPS, MAX_PLACEMENTS, emptyGroupDocument,
  groupProjection, migrateLegacyDocument, validateGroupDocument };
