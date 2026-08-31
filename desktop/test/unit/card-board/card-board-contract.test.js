'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_CARD_BOARD_DECKS,
  MAX_CARD_BOARD_PLACEMENTS,
  cardRefIdentity,
  emptyCardBoardLayoutDocument,
  validateCardBoardLayoutDocument,
} = require('../../../lib/card-board/schema/card-board-contract');

function sampleDocument() {
  return {
    schemaVersion: 1,
    revision: 4,
    placements: [
      {
        placementId: 'placement_abcdefghijkl',
        boardId: 'browser-catalog',
        card: { kind: 'official-category', id: 'courses' },
        deckId: 'deck_abcdefghijkl',
        order: 0,
        size: 'small',
        hidden: false,
      },
      {
        placementId: 'placement_mnopqrstuvwx',
        boardId: 'browser-catalog',
        card: { kind: 'official-category', id: 'research' },
        deckId: 'deck_abcdefghijkl',
        order: 1,
        size: 'medium',
        hidden: false,
      },
      {
        placementId: 'placement_yzabcdefghij',
        boardId: 'connect',
        card: { kind: 'system-widget', id: 'network-adapter' },
        deckId: null,
        order: 0,
        size: 'large',
        hidden: false,
      },
    ],
    decks: [{
      deckId: 'deck_abcdefghijkl',
      boardId: 'browser-catalog',
      placementIds: ['placement_abcdefghijkl', 'placement_mnopqrstuvwx'],
      activePlacementId: 'placement_abcdefghijkl',
      order: 0,
    }],
  };
}

test('card board v1 schema retains only bounded logical references and canonical decks', () => {
  const document = validateCardBoardLayoutDocument(sampleDocument());
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.revision, 4);
  assert.equal(document.decks[0].placementIds.length, 2);
  assert.equal(cardRefIdentity(document.placements[0].card), 'official-category:courses');
  assert.deepEqual(emptyCardBoardLayoutDocument(), {
    schemaVersion: 1, revision: 0, placements: [], decks: [],
  });
  assert.equal(Object.isFrozen(document), true);
  assert.equal(Object.isFrozen(document.placements), true);
});

test('card board schema rejects URL, HTML, coordinates, duplicate cards and inconsistent decks', () => {
  const withMutation = (mutate) => {
    const value = structuredClone(sampleDocument());
    mutate(value);
    return value;
  };
  assert.throws(() => validateCardBoardLayoutDocument(withMutation((value) => {
    value.placements[0].card.id = 'https://example.edu/?token=secret';
  })), /invalid/u);
  assert.throws(() => validateCardBoardLayoutDocument(withMutation((value) => {
    value.placements[0].card.id = '<img-onerror-alert>';
  })), /invalid/u);
  assert.throws(() => validateCardBoardLayoutDocument(withMutation((value) => {
    value.placements[0].x = 120;
  })), /schema|invalid/u);
  assert.throws(() => validateCardBoardLayoutDocument(withMutation((value) => {
    value.placements[1].card = { ...value.placements[0].card };
  })), /duplicate/u);
  assert.throws(() => validateCardBoardLayoutDocument(withMutation((value) => {
    value.decks[0].activePlacementId = 'placement_yzabcdefghij';
  })), /deck/u);
  assert.throws(() => validateCardBoardLayoutDocument(withMutation((value) => {
    value.placements[1].order = 3;
  })), /canonical|deck/u);
  assert.throws(() => validateCardBoardLayoutDocument({
    schemaVersion: 1,
    revision: 0,
    placements: Array.from({ length: MAX_CARD_BOARD_PLACEMENTS + 1 }, () => ({})),
    decks: [],
  }), /limit|invalid/u);
  assert.throws(() => validateCardBoardLayoutDocument({
    schemaVersion: 1,
    revision: 0,
    placements: [],
    decks: Array.from({ length: MAX_CARD_BOARD_DECKS + 1 }, () => ({})),
  }), /limit|invalid/u);
});

test('card board schema accepts only known system widgets and compatible boards', () => {
  assert.throws(() => validateCardBoardLayoutDocument({
    schemaVersion: 1,
    revision: 0,
    placements: [{
      placementId: 'placement_abcdefghijkl',
      boardId: 'browser-catalog',
      card: { kind: 'system-widget', id: 'remote-html-widget' },
      deckId: null,
      order: 0,
      size: 'small',
      hidden: false,
    }],
    decks: [],
  }), /system widget|invalid/u);
  assert.throws(() => validateCardBoardLayoutDocument({
    schemaVersion: 1,
    revision: 0,
    placements: [{
      placementId: 'placement_abcdefghijkl',
      boardId: 'browser-personal',
      card: { kind: 'official-category', id: 'courses' },
      deckId: null,
      order: 0,
      size: 'small',
      hidden: false,
    }],
    decks: [],
  }), /board|invalid/u);
});
