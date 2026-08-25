'use strict';

const {
  MAX_FAVORITE_RESOURCES,
  MAX_RECENT_RESOURCES,
  validateFavoriteResourceDocument,
  validateRecentResourceDocument,
  validateResourceId,
} = require('../schema/resource-activity-contract');

function availableResourceIds(resources) {
  return new Set((Array.isArray(resources) ? resources : []).map(({ id }) => validateResourceId(id)));
}

function toggleFavoriteResource(document, resourceId, resources) {
  const current = validateFavoriteResourceDocument(document);
  const id = validateResourceId(resourceId);
  if (!availableResourceIds(resources).has(id)) throw new Error('resource is unavailable');
  const exists = current.entries.includes(id);
  const entries = exists
    ? current.entries.filter((entry) => entry !== id)
    : [...current.entries, id];
  if (entries.length > MAX_FAVORITE_RESOURCES) throw new Error('favorite resource limit reached');
  return validateFavoriteResourceDocument({ schemaVersion: 1, entries });
}

function recordRecentResource(document, resourceId, openedAt, resources) {
  const current = validateRecentResourceDocument(document);
  const id = validateResourceId(resourceId);
  if (!availableResourceIds(resources).has(id)) throw new Error('resource is unavailable');
  if (!Number.isSafeInteger(openedAt) || openedAt <= 0) {
    throw new TypeError('resource open timestamp is invalid');
  }
  const entries = [
    { resourceId: id, openedAt },
    ...current.entries.filter(({ resourceId: entryId }) => entryId !== id),
  ].slice(0, MAX_RECENT_RESOURCES);
  return validateRecentResourceDocument({ schemaVersion: 1, entries });
}

function projectResourceActivity(resources, favorites, recent) {
  const favoriteDocument = validateFavoriteResourceDocument(favorites);
  const recentDocument = validateRecentResourceDocument(recent);
  const favoriteIds = new Set(favoriteDocument.entries);
  const openedAtById = new Map(
    recentDocument.entries.map(({ resourceId, openedAt }) => [resourceId, openedAt]),
  );
  return Object.freeze((Array.isArray(resources) ? resources : []).map((resource) => Object.freeze({
    ...resource,
    favorite: favoriteIds.has(resource.id),
    lastOpenedAt: openedAtById.get(resource.id) || null,
  })));
}

module.exports = {
  projectResourceActivity,
  recordRecentResource,
  toggleFavoriteResource,
};
