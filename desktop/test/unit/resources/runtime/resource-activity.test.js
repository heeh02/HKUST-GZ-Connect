'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  projectResourceActivity,
  recordRecentResource,
  toggleFavoriteResource,
} = require('../../../../lib/resources/runtime/resource-activity');

const resources = Object.freeze([
  Object.freeze({ id: 'home', name: 'Home' }),
  Object.freeze({ id: 'canvas', name: 'Canvas' }),
]);

test('favorites toggle by resource ID and never retain removed resources', () => {
  const empty = { schemaVersion: 1, entries: [] };
  const added = toggleFavoriteResource(empty, 'canvas', resources);
  assert.deepEqual(added.entries, ['canvas']);
  assert.deepEqual(toggleFavoriteResource(added, 'canvas', resources).entries, []);
  assert.throws(() => toggleFavoriteResource(empty, 'missing', resources), /unavailable/u);
});

test('recent resources are unique newest-first and projection drops stale activity', () => {
  let recent = { schemaVersion: 1, entries: [] };
  recent = recordRecentResource(recent, 'home', 10, resources);
  recent = recordRecentResource(recent, 'canvas', 20, resources);
  recent = recordRecentResource(recent, 'home', 30, resources);
  assert.deepEqual(recent.entries, [
    { resourceId: 'home', openedAt: 30 },
    { resourceId: 'canvas', openedAt: 20 },
  ]);
  const projection = projectResourceActivity(
    resources,
    { schemaVersion: 1, entries: ['canvas', 'removed'] },
    { schemaVersion: 1, entries: [
      { resourceId: 'removed', openedAt: 40 },
      { resourceId: 'home', openedAt: 30 },
    ] },
  );
  assert.deepEqual(projection.map(({ id, favorite, lastOpenedAt }) => ({
    id, favorite, lastOpenedAt,
  })), [
    { id: 'home', favorite: false, lastOpenedAt: 30 },
    { id: 'canvas', favorite: true, lastOpenedAt: null },
  ]);
});
