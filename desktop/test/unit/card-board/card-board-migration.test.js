'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  cardRefIdentity,
  validateCardBoardLayoutDocument,
} = require('../../../lib/card-board/schema/card-board-contract');
const {
  createDefaultCardBoardLayout,
  normalizeCardBoardAuthority,
  reconcileCardBoardLayout,
} = require('../../../lib/card-board/runtime/card-board-migration');

const WIDGET_IDS = Object.freeze([
  'connection-metrics', 'network-adapter', 'connection-details',
]);

function authority(overrides = {}) {
  return {
    officialCategoryIds: ['gateway', 'courses', 'research'],
    userCollectionIds: ['study', 'expenses'],
    includeUngroupedFavorites: true,
    connectWidgetIds: [...WIDGET_IDS],
    ...overrides,
  };
}

function visibleRefs(document, boardId) {
  return document.placements
    .filter((placement) => placement.boardId === boardId && !placement.hidden)
    .sort((left, right) => left.order - right.order)
    .map((placement) => cardRefIdentity(placement.card));
}

test('default layout separates official, personal, and fixed connect widgets', () => {
  const document = createDefaultCardBoardLayout(authority());
  validateCardBoardLayoutDocument(document, { resolveCardRef: () => true });
  assert.deepEqual(visibleRefs(document, 'browser-catalog'), [
    'official-category:gateway',
    'official-category:courses',
    'official-category:research',
  ]);
  assert.deepEqual(visibleRefs(document, 'browser-personal'), [
    'user-collection:study',
    'user-collection:expenses',
    'system-widget:ungrouped-favorites',
  ]);
  assert.deepEqual(visibleRefs(document, 'connect'), [
    'system-widget:connection-metrics',
    'system-widget:network-adapter',
    'system-widget:connection-details',
  ]);
});

test('custom Profile without an official catalogue keeps the personal board usable', () => {
  const document = createDefaultCardBoardLayout(authority({ officialCategoryIds: [] }));
  assert.deepEqual(visibleRefs(document, 'browser-catalog'), []);
  assert.deepEqual(visibleRefs(document, 'browser-personal'), [
    'user-collection:study',
    'user-collection:expenses',
    'system-widget:ungrouped-favorites',
  ]);
  assert.ok(visibleRefs(document, 'connect').length > 0,
    'custom Profile fallback must not remove connection widgets');
});

test('authority normalization rejects unknown widgets and duplicate IDs', () => {
  assert.throws(() => normalizeCardBoardAuthority(authority({
    connectWidgetIds: ['network-adapter', 'credential-secret'],
  })));
  const normalized = normalizeCardBoardAuthority(authority({
    officialCategoryIds: ['courses', 'courses'],
    userCollectionIds: ['study', 'study'],
  }));
  assert.deepEqual(normalized.officialCategoryIds, ['courses']);
  assert.deepEqual(normalized.userCollectionIds, ['study']);
});

test('catalog reconciliation appends new official categories without disturbing saved order', () => {
  const initial = structuredClone(createDefaultCardBoardLayout(authority({
    officialCategoryIds: ['gateway', 'courses'],
  })));
  const gateway = initial.placements.find(({ card }) => cardRefIdentity(card) === 'official-category:gateway');
  const courses = initial.placements.find(({ card }) => cardRefIdentity(card) === 'official-category:courses');
  gateway.order = 1;
  courses.order = 0;
  const reconciled = reconcileCardBoardLayout(initial, authority({
    officialCategoryIds: ['gateway', 'courses', 'research'],
  }));
  assert.deepEqual(visibleRefs(reconciled, 'browser-catalog'), [
    'official-category:courses',
    'official-category:gateway',
    'official-category:research',
  ]);
});

test('deleting a user collection retires every placement but preserves other cards', () => {
  const initial = structuredClone(createDefaultCardBoardLayout(authority()));
  const study = initial.placements.find(({ card }) => cardRefIdentity(card) === 'user-collection:study');
  initial.placements.push({
    ...study,
    placementId: 'placement_study_connect',
    boardId: 'connect',
    deckId: null,
    order: 99,
  });
  const reconciled = reconcileCardBoardLayout(initial, authority({
    userCollectionIds: ['expenses'],
  }));
  assert.equal(reconciled.placements.some(({ card }) => (
    cardRefIdentity(card) === 'user-collection:study'
  )), false);
  assert.ok(reconciled.placements.some(({ card }) => (
    cardRefIdentity(card) === 'user-collection:expenses'
  )));
  assert.ok(reconciled.placements.some(({ card }) => (
    cardRefIdentity(card) === 'official-category:courses'
  )));
});
