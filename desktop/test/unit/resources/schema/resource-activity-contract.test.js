'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_FAVORITE_RESOURCES,
  MAX_RECENT_RESOURCES,
  emptyFavoriteResourceDocument,
  emptyRecentResourceDocument,
  validateFavoriteResourceDocument,
  validateRecentResourceDocument,
} = require('../../../../lib/resources/schema/resource-activity-contract');

test('favorite and recent documents are exact bounded and immutable', () => {
  const favorites = validateFavoriteResourceDocument({
    schemaVersion: 1,
    entries: ['home', 'canvas'],
  });
  const recent = validateRecentResourceDocument({
    schemaVersion: 1,
    entries: [
      { resourceId: 'canvas', openedAt: 20 },
      { resourceId: 'home', openedAt: 10 },
    ],
  });
  assert.equal(Object.isFrozen(favorites.entries), true);
  assert.equal(Object.isFrozen(recent.entries[0]), true);
  assert.deepEqual(emptyFavoriteResourceDocument().entries, []);
  assert.deepEqual(emptyRecentResourceDocument().entries, []);
});

test('activity documents reject drift duplicates and unbounded histories', () => {
  assert.throws(() => validateFavoriteResourceDocument({ schemaVersion: 2, entries: [] }), /version/u);
  assert.throws(() => validateFavoriteResourceDocument({ schemaVersion: 1, entries: ['home', 'home'] }), /duplicate/u);
  assert.throws(() => validateFavoriteResourceDocument({
    schemaVersion: 1,
    entries: Array.from({ length: MAX_FAVORITE_RESOURCES + 1 }, (_, index) => `r-${index}`),
  }), /count/u);
  assert.throws(() => validateRecentResourceDocument({
    schemaVersion: 1,
    entries: [
      { resourceId: 'old', openedAt: 1 },
      { resourceId: 'new', openedAt: 2 },
    ],
  }), /canonical/u);
  assert.throws(() => validateRecentResourceDocument({
    schemaVersion: 1,
    entries: Array.from({ length: MAX_RECENT_RESOURCES + 1 }, (_, index) => ({
      resourceId: `r-${index}`,
      openedAt: MAX_RECENT_RESOURCES + 1 - index,
    })),
  }), /count/u);
});
