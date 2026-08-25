'use strict';

const RESOURCE_ACTIVITY_DOCUMENT_VERSION = 1;
const MAX_FAVORITE_RESOURCES = 64;
const MAX_RECENT_RESOURCES = 32;
const MAX_RESOURCE_ID_LENGTH = 40;
const SAFE_RESOURCE_ID = /^[a-z0-9-]+$/u;

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

function resourceId(value) {
  if (typeof value !== 'string' || !SAFE_RESOURCE_ID.test(value) ||
      value.length > MAX_RESOURCE_ID_LENGTH) {
    throw new TypeError('resource ID is invalid');
  }
  return value;
}

function documentVersion(value, name) {
  if (value !== RESOURCE_ACTIVITY_DOCUMENT_VERSION) {
    throw new TypeError(`${name} version is unsupported`);
  }
  return RESOURCE_ACTIVITY_DOCUMENT_VERSION;
}

function validateFavoriteResourceDocument(value) {
  const source = exactKeys(value, ['schemaVersion', 'entries'], 'favorite resources');
  if (!Array.isArray(source.entries) || source.entries.length > MAX_FAVORITE_RESOURCES) {
    throw new TypeError('favorite resources have an invalid count');
  }
  const entries = source.entries.map(resourceId);
  if (new Set(entries).size !== entries.length) {
    throw new TypeError('favorite resources contain a duplicate');
  }
  return Object.freeze({
    schemaVersion: documentVersion(source.schemaVersion, 'favorite resources'),
    entries: Object.freeze(entries),
  });
}

function validateRecentResourceDocument(value) {
  const source = exactKeys(value, ['schemaVersion', 'entries'], 'recent resources');
  if (!Array.isArray(source.entries) || source.entries.length > MAX_RECENT_RESOURCES) {
    throw new TypeError('recent resources have an invalid count');
  }
  const entries = source.entries.map((entry) => {
    const item = exactKeys(entry, ['resourceId', 'openedAt'], 'recent resource');
    if (!Number.isSafeInteger(item.openedAt) || item.openedAt <= 0) {
      throw new TypeError('recent resource timestamp is invalid');
    }
    return Object.freeze({ resourceId: resourceId(item.resourceId), openedAt: item.openedAt });
  });
  if (new Set(entries.map(({ resourceId: id }) => id)).size !== entries.length ||
      entries.some((entry, index) => index > 0 && entry.openedAt > entries[index - 1].openedAt)) {
    throw new TypeError('recent resources are not canonical');
  }
  return Object.freeze({
    schemaVersion: documentVersion(source.schemaVersion, 'recent resources'),
    entries: Object.freeze(entries),
  });
}

function emptyFavoriteResourceDocument() {
  return validateFavoriteResourceDocument({ schemaVersion: 1, entries: [] });
}

function emptyRecentResourceDocument() {
  return validateRecentResourceDocument({ schemaVersion: 1, entries: [] });
}

module.exports = {
  MAX_FAVORITE_RESOURCES,
  MAX_RECENT_RESOURCES,
  RESOURCE_ACTIVITY_DOCUMENT_VERSION,
  emptyFavoriteResourceDocument,
  emptyRecentResourceDocument,
  validateFavoriteResourceDocument,
  validateRecentResourceDocument,
  validateResourceId: resourceId,
};
