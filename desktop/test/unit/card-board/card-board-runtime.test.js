'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CardBoardRuntime,
  applyCardBoardOperations,
} = require('../../../lib/card-board/runtime/card-board-runtime');
const {
  createDefaultCardBoardLayout,
  reconcileCardBoardLayout,
} = require('../../../lib/card-board/runtime/card-board-migration');
const { validateCardBoardLayoutDocument } = require('../../../lib/card-board/schema/card-board-contract');

const authority = (overrides = {}) => ({
  officialCategoryIds: ['courses', 'research', 'laboratories'],
  userCollectionIds: ['group_abcdefghijkl'],
  includeUngroupedFavorites: true,
  connectWidgetIds: ['connection-metrics', 'network-adapter', 'connection-details'],
  ...overrides,
});

function deterministicEntropy() {
  let seed = 1;
  return (size) => Buffer.alloc(size, seed++);
}

class MemoryStore {
  constructor(value = null) { this.value = value; this.writes = 0; }
  read() { return this.value ? structuredClone(this.value) : null; }
  replace(value) {
    this.value = structuredClone(validateCardBoardLayoutDocument(value));
    this.writes += 1;
    return structuredClone(this.value);
  }
}

function placement(document, boardId, kind, id) {
  return document.placements.find((candidate) => candidate.boardId === boardId &&
    candidate.card.kind === kind && candidate.card.id === id);
}

test('default migration creates authoritative boards without URL or presentation material', () => {
  const document = createDefaultCardBoardLayout(authority(), { randomBytes: deterministicEntropy() });
  assert.equal(document.revision, 0);
  assert.deepEqual(document.placements.filter(({ boardId }) => boardId === 'browser-catalog')
    .map(({ card }) => card.id), ['courses', 'research', 'laboratories']);
  assert.deepEqual(document.placements.filter(({ boardId }) => boardId === 'browser-personal')
    .map(({ card }) => card.id), ['group_abcdefghijkl', 'ungrouped-favorites']);
  assert.deepEqual(document.placements.filter(({ boardId }) => boardId === 'connect')
    .map(({ card }) => card.id), ['connection-metrics', 'network-adapter', 'connection-details']);
  assert.doesNotMatch(JSON.stringify(document), /https?:|<[^>]+>|"x"|"y"/u);
});

test('runtime pins a copy to connect and rejects stale revisions without partial writes', () => {
  const store = new MemoryStore();
  const runtime = new CardBoardRuntime({ store, randomBytes: deterministicEntropy() });
  const initial = runtime.snapshot(authority());
  const source = placement(initial.document, 'browser-catalog', 'official-category', 'courses');
  const committed = runtime.commit({
    baseRevision: 0,
    operations: [{
      type: 'pin-to-board', sourcePlacementId: source.placementId,
      boardId: 'connect', index: 1, size: 'medium',
    }],
  }, authority());
  assert.equal(committed.document.revision, 1);
  assert.ok(placement(committed.document, 'browser-catalog', 'official-category', 'courses'));
  assert.ok(placement(committed.document, 'connect', 'official-category', 'courses'));
  const beforeConflict = structuredClone(store.value);
  assert.throws(() => runtime.commit({
    baseRevision: 0,
    operations: [{
      type: 'resize-placement', placementId: source.placementId, size: 'large',
    }],
  }, authority()), (error) => error.code === 'CARD_BOARD_REVISION_CONFLICT');
  assert.deepEqual(store.value, beforeConflict);
});

test('a revision-bound batch rolls back every operation when one operation is invalid', () => {
  const store = new MemoryStore();
  const runtime = new CardBoardRuntime({ store, randomBytes: deterministicEntropy() });
  const initial = runtime.snapshot(authority()).document;
  const source = placement(initial, 'browser-catalog', 'official-category', 'courses');
  const writes = store.writes;
  assert.throws(() => runtime.commit({
    baseRevision: initial.revision,
    operations: [
      { type: 'resize-placement', placementId: source.placementId, size: 'large' },
      { type: 'remove-from-board', placementId: source.placementId },
    ],
  }, authority()), /connect|default|remove/u);
  assert.equal(store.writes, writes);
  assert.equal(placement(store.value, 'browser-catalog', 'official-category', 'courses').size, 'small');
});

test('deck operations create, reorder, insert, extract and dissolve canonical decks', () => {
  const entropy = deterministicEntropy();
  let document = createDefaultCardBoardLayout(authority(), { randomBytes: entropy });
  const courses = placement(document, 'browser-catalog', 'official-category', 'courses');
  const research = placement(document, 'browser-catalog', 'official-category', 'research');
  const labs = placement(document, 'browser-catalog', 'official-category', 'laboratories');
  document = applyCardBoardOperations(document, [{
    type: 'create-deck', boardId: 'browser-catalog',
    placementIds: [courses.placementId, research.placementId],
    activePlacementId: research.placementId, index: 0,
  }], authority(), { randomBytes: entropy });
  assert.equal(document.decks.length, 1);
  const deckId = document.decks[0].deckId;
  document = applyCardBoardOperations(document, [{
    type: 'move-into-deck', placementId: labs.placementId, deckId, index: 1,
  }], authority(), { randomBytes: entropy });
  assert.deepEqual(document.decks[0].placementIds,
    [courses.placementId, labs.placementId, research.placementId]);
  document = applyCardBoardOperations(document, [{
    type: 'move-into-deck', placementId: courses.placementId, deckId, index: 3,
  }], authority(), { randomBytes: entropy });
  assert.deepEqual(document.decks[0].placementIds,
    [labs.placementId, research.placementId, courses.placementId]);
  document = applyCardBoardOperations(document, [{
    type: 'remove-from-deck', placementId: labs.placementId, index: 1,
  }], authority(), { randomBytes: entropy });
  assert.equal(document.decks.length, 1);
  document = applyCardBoardOperations(document, [{
    type: 'remove-from-deck', placementId: research.placementId, index: 0,
  }], authority(), { randomBytes: entropy });
  assert.equal(document.decks.length, 0, 'a one-card deck dissolves');
  assert.equal(document.placements.every(({ deckId: id }) => id === null), true);
  validateCardBoardLayoutDocument(document);
});

test('all placement operations preserve the referenced category domain', () => {
  const entropy = deterministicEntropy();
  let document = createDefaultCardBoardLayout(authority(), { randomBytes: entropy });
  const courses = placement(document, 'browser-catalog', 'official-category', 'courses');
  document = applyCardBoardOperations(document, [{
    type: 'move-placement', placementId: courses.placementId,
    boardId: 'browser-catalog', index: 2,
  }, {
    type: 'resize-placement', placementId: courses.placementId, size: 'large',
  }, {
    type: 'hide-placement', placementId: courses.placementId,
  }, {
    type: 'restore-default-placement', placementId: courses.placementId,
  }, {
    type: 'insert-placement', boardId: 'connect',
    card: { kind: 'official-category', id: 'research' }, index: 2, size: 'small',
  }], authority(), { randomBytes: entropy });
  const restored = placement(document, 'browser-catalog', 'official-category', 'courses');
  assert.equal(restored.hidden, false);
  assert.equal(restored.size, 'small');
  const inserted = placement(document, 'connect', 'official-category', 'research');
  document = applyCardBoardOperations(document, [{
    type: 'remove-from-board', placementId: inserted.placementId,
  }], authority(), { randomBytes: entropy });
  assert.equal(placement(document, 'connect', 'official-category', 'research'), undefined);
  assert.ok(placement(document, 'browser-catalog', 'official-category', 'research'),
    'removing a placement does not delete the category');
});

test('reconciliation appends new official defaults and removes deleted user collections everywhere', () => {
  const entropy = deterministicEntropy();
  const initialAuthority = authority({ officialCategoryIds: ['courses'],
    userCollectionIds: ['group_abcdefghijkl'] });
  let document = createDefaultCardBoardLayout(initialAuthority, { randomBytes: entropy });
  const personal = placement(document, 'browser-personal', 'user-collection', 'group_abcdefghijkl');
  document = applyCardBoardOperations(document, [{
    type: 'pin-to-board', sourcePlacementId: personal.placementId,
    boardId: 'connect', index: 0, size: 'small',
  }], initialAuthority, { randomBytes: entropy });
  const reconciled = reconcileCardBoardLayout(document, authority({
    officialCategoryIds: ['courses', 'research'],
    userCollectionIds: [],
  }), { randomBytes: entropy });
  assert.ok(placement(reconciled, 'browser-catalog', 'official-category', 'research'));
  assert.equal(reconciled.placements.some(({ card }) => card.kind === 'user-collection'), false);
});

test('reset replaces only layout state and advances the current revision', () => {
  const store = new MemoryStore();
  const runtime = new CardBoardRuntime({ store, randomBytes: deterministicEntropy() });
  const initial = runtime.snapshot(authority()).document;
  const courses = placement(initial, 'browser-catalog', 'official-category', 'courses');
  const changed = runtime.commit({ baseRevision: 0, operations: [{
    type: 'hide-placement', placementId: courses.placementId,
  }] }, authority()).document;
  const reset = runtime.reset({ baseRevision: changed.revision }, authority());
  assert.equal(reset.document.revision, changed.revision + 1);
  assert.equal(placement(reset.document, 'browser-catalog', 'official-category', 'courses').hidden, false);
  assert.equal(reset.changed, true);
});
