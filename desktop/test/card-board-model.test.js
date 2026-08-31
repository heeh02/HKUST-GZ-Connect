'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const boardModel = require('../renderer/components/card-board/card-board-model');

function card(kind, id) {
  return Object.freeze({ kind, id });
}

function placementFor(document, kind, id, boardId) {
  return document.placements.find((placement) => (
    placement.boardId === boardId && placement.card.kind === kind && placement.card.id === id
  ));
}

test('responsive projection uses the approved 1/2/3/4-column board thresholds', () => {
  for (const [width, expected] of [
    [0, 1], [759, 1], [760, 2], [1099, 2],
    [1100, 3], [1439, 3], [1440, 4], [4096, 4],
  ]) assert.equal(boardModel.columnsForWidth(width), expected, `${width}px board width`);
});

test('website density follows card content width and never expands beyond two columns', () => {
  for (const [width, expected] of [
    [0, 1], [439, 1], [440, 2], [719, 2], [720, 2], [1600, 2],
  ]) assert.equal(boardModel.resourceColumnsForWidth(width), expected, `${width}px card width`);
});

test('official, personal, and connect cards remain separate logical boards', () => {
  const document = boardModel.defaultDocument({
    'browser-catalog': [card('official-category', 'courses'), card('official-category', 'research')],
    'browser-personal': [card('user-collection', 'study'), card('system-widget', 'ungrouped-favorites')],
    connect: [card('system-widget', 'connection-metrics'), card('system-widget', 'network-adapter')],
  });
  assert.deepEqual(boardModel.boardUnits(document, 'browser-catalog')
    .flatMap(({ placements }) => placements.map(({ card: ref }) => boardModel.cardKey(ref))), [
    'official-category:courses', 'official-category:research',
  ]);
  assert.deepEqual(boardModel.boardUnits(document, 'browser-personal')
    .flatMap(({ placements }) => placements.map(({ card: ref }) => boardModel.cardKey(ref))), [
    'user-collection:study', 'system-widget:ungrouped-favorites',
  ]);
  assert.deepEqual(boardModel.boardUnits(document, 'connect')
    .flatMap(({ placements }) => placements.map(({ card: ref }) => boardModel.cardKey(ref))), [
    'system-widget:connection-metrics', 'system-widget:network-adapter',
  ]);
});

test('custom Profile fallback can expose personal cards with an empty official board', () => {
  const document = boardModel.defaultDocument({
    'browser-catalog': [],
    'browser-personal': [card('user-collection', 'custom-study')],
    connect: [card('system-widget', 'connection-metrics')],
  });
  assert.deepEqual(boardModel.boardUnits(document, 'browser-catalog'), []);
  assert.equal(boardModel.boardUnits(document, 'browser-personal').length, 1);
  assert.equal(boardModel.boardUnits(document, 'connect').length, 1);
});

test('one expanded placement is tracked independently per deck and toggles closed', () => {
  const first = boardModel.toggleExpandedPlacement({}, 'deck-a', 'placement-a');
  assert.deepEqual(first, { 'deck-a': 'placement-a' });
  const second = boardModel.toggleExpandedPlacement(first, 'deck-b', 'placement-b');
  assert.deepEqual(second, { 'deck-a': 'placement-a', 'deck-b': 'placement-b' });
  const replacement = boardModel.toggleExpandedPlacement(second, 'deck-a', 'placement-c');
  assert.deepEqual(replacement, { 'deck-a': 'placement-c', 'deck-b': 'placement-b' });
  const collapsed = boardModel.toggleExpandedPlacement(replacement, 'deck-a', 'placement-c');
  assert.deepEqual(collapsed, { 'deck-b': 'placement-b' });
  assert.equal(Object.isFrozen(collapsed), true);
});

test('draft drop operations distinguish insertion, stacking, and extraction', () => {
  const initial = boardModel.defaultDocument({
    'browser-catalog': [
      card('official-category', 'courses'),
      card('official-category', 'research'),
      card('official-category', 'labs'),
    ],
  });
  const courses = placementFor(initial, 'official-category', 'courses', 'browser-catalog');
  const research = placementFor(initial, 'official-category', 'research', 'browser-catalog');
  const labs = placementFor(initial, 'official-category', 'labs', 'browser-catalog');
  const moved = boardModel.applyDraftOperation(initial, {
    type: 'move-placement', placementId: labs.placementId, boardId: 'browser-catalog', index: 0,
  });
  assert.equal(boardModel.boardUnits(moved, 'browser-catalog')[0].unitId, labs.placementId);

  const decked = boardModel.applyDraftOperation(moved, {
    type: 'create-deck', boardId: 'browser-catalog',
    placementIds: [courses.placementId, research.placementId],
    activePlacementId: research.placementId, index: 1,
  });
  const deck = decked.decks[0];
  assert.deepEqual(deck.placementIds, [courses.placementId, research.placementId]);
  assert.equal(deck.activePlacementId, research.placementId);

  const extracted = boardModel.applyDraftOperation(decked, {
    type: 'remove-from-deck', placementId: research.placementId, index: 0,
  });
  assert.equal(placementFor(extracted, 'official-category', 'research', 'browser-catalog').deckId, null);
  assert.equal(extracted.decks.some(({ placementIds }) => (
    placementIds.includes(research.placementId)
  )), false);
  assert.deepEqual(initial, boardModel.defaultDocument({
    'browser-catalog': [
      card('official-category', 'courses'),
      card('official-category', 'research'),
      card('official-category', 'labs'),
    ],
  }), 'draft operations mutated their input document');
});

test('pinning to connect creates a layout reference and preserves the browser card', () => {
  const initial = boardModel.defaultDocument({
    'browser-catalog': [card('official-category', 'courses')],
    connect: [card('system-widget', 'connection-metrics')],
  });
  const source = placementFor(initial, 'official-category', 'courses', 'browser-catalog');
  const pinned = boardModel.applyDraftOperation(initial, {
    type: 'pin-to-board', sourcePlacementId: source.placementId,
    boardId: 'connect', index: 1, size: 'medium',
  });
  const sourceAfter = placementFor(pinned, 'official-category', 'courses', 'browser-catalog');
  const connectCopy = placementFor(pinned, 'official-category', 'courses', 'connect');
  assert.ok(sourceAfter);
  assert.ok(connectCopy);
  assert.notEqual(sourceAfter.placementId, connectCopy.placementId);
  const removed = boardModel.applyDraftOperation(pinned, {
    type: 'remove-from-board', placementId: connectCopy.placementId,
  });
  assert.ok(placementFor(removed, 'official-category', 'courses', 'browser-catalog'));
  assert.equal(placementFor(removed, 'official-category', 'courses', 'connect'), undefined);
});
