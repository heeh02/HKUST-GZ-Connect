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
    [0, 1], [655, 1], [656, 2], [991, 2],
    [992, 3], [1351, 3], [1352, 4], [4096, 4],
  ]) assert.equal(boardModel.columnsForWidth(width), expected, `${width}px board width`);
});

test('website density follows card content width and never expands beyond two columns', () => {
  for (const [width, expected] of [
    [0, 1], [359, 1], [360, 2], [719, 2], [720, 2], [1600, 2],
  ]) assert.equal(boardModel.resourceColumnsForWidth(width), expected, `${width}px card width`);
});

test('six cards are dealt into three two-card stacks when only three slots fit', () => {
  const cards = Array.from({ length: 6 }, (_, index) => card('official-category', `category-${index}`));
  const document = boardModel.defaultDocument({ 'browser-catalog': cards });
  const compact = boardModel.presentationUnits(document, 'browser-catalog', {
    columns: 3,
    availableHeight: 560,
  });
  assert.equal(compact.capacity.rows, 1);
  assert.equal(compact.capacity.slotCount, 3);
  assert.deepEqual(compact.units.map(({ placements }) => placements.length), [2, 2, 2]);
  assert.equal(compact.units.every(({ automatic }) => automatic === true), true);
  assert.deepEqual(compact.units.flatMap(({ placements }) => placements.map(({ card: ref }) => ref.id)),
    cards.map(({ id }) => id), 'automatic stacks changed the logical card order');
  assert.equal(document.decks.length, 0, 'responsive stacking leaked into persisted layout data');
});

test('automatic stacks never exceed three cards even when the viewport has one slot', () => {
  const cards = Array.from({ length: 12 }, (_, index) => card('official-category', `category-${index}`));
  const document = boardModel.defaultDocument({ 'browser-catalog': cards });
  for (const columns of [1, 2, 4]) {
    const projected = boardModel.presentationUnits(document, 'browser-catalog', {
      columns,
      availableHeight: 560,
    });
    assert.equal(projected.units.length, 4, `${columns} columns must keep four shallow decks`);
    assert.deepEqual(projected.units.map(({ placements }) => placements.length), [3, 3, 3, 3]);
    assert.equal(Math.max(...projected.units.map(({ placements }) => placements.length)), 3);
  }
  assert.equal(document.decks.length, 0, 'shallow responsive decks must remain presentation-only');
});

test('vertical expansion deals automatic stacks back into independent slots', () => {
  const document = boardModel.defaultDocument({
    'browser-catalog': Array.from({ length: 6 }, (_, index) => (
      card('official-category', `category-${index}`)
    )),
  });
  const expanded = boardModel.presentationUnits(document, 'browser-catalog', {
    columns: 3,
    availableHeight: 720,
  });
  assert.deepEqual(expanded.capacity, { columns: 3, rows: 2, slotCount: 6 });
  assert.deepEqual(expanded.units.map(({ placements }) => placements.length), [1, 1, 1, 1, 1, 1]);
  assert.equal(expanded.units.every(({ automatic }) => automatic === false), true);
});

test('responsive dealing treats a persisted manual deck as one logical unit without rewriting it', () => {
  const initial = boardModel.defaultDocument({
    'browser-catalog': Array.from({ length: 5 }, (_, index) => (
      card('official-category', `category-${index}`)
    )),
  });
  const first = initial.placements[0];
  const second = initial.placements[1];
  const manual = boardModel.applyDraftOperation(initial, {
    type: 'create-deck', boardId: 'browser-catalog',
    placementIds: [first.placementId, second.placementId],
    activePlacementId: second.placementId, index: 0,
  });
  const before = boardModel.cloneDocument(manual);
  const presentation = boardModel.presentationUnits(manual, 'browser-catalog', {
    columns: 2, availableHeight: 500,
  });
  assert.equal(presentation.units.length, 2);
  assert.deepEqual(presentation.units.map(({ placements }) => placements.length), [3, 2]);
  assert.deepEqual(manual, before, 'responsive projection rewrote the persisted manual deck');
  assert.equal(manual.decks.length, 1);
  assert.deepEqual(manual.decks[0].placementIds, [first.placementId, second.placementId]);
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
