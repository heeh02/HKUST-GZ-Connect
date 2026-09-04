'use strict';

const CARD_BOARD_SCHEMA_VERSION = 1;
const MAX_CARD_BOARD_PLACEMENTS = 96;
const MAX_CARD_BOARD_DECKS = 32;
const MAX_DECK_PLACEMENTS = 16;
const MAX_CARD_REF_ID_LENGTH = 80;

const BOARD_IDS = Object.freeze(['browser-catalog', 'browser-personal', 'connect']);
const CARD_KINDS = Object.freeze(['official-category', 'user-collection', 'system-widget']);
const SIZE_PRESETS = Object.freeze(['small', 'medium', 'large']);
const SYSTEM_WIDGET_IDS = Object.freeze([
  'ungrouped-favorites',
  'connection-metrics',
  'network-adapter',
  'connection-details',
]);

const BOARD_SET = new Set(BOARD_IDS);
const CARD_KIND_SET = new Set(CARD_KINDS);
const SIZE_SET = new Set(SIZE_PRESETS);
const SYSTEM_WIDGET_SET = new Set(SYSTEM_WIDGET_IDS);
const CARD_REF_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const PLACEMENT_ID = /^placement_[a-z0-9_-]{12,80}$/u;
const DECK_ID = /^deck_[a-z0-9_-]{12,80}$/u;

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} is invalid`);
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

function safeInteger(value, name, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function validateCardRef(input) {
  const value = exactKeys(input, ['kind', 'id'], 'card reference');
  if (!CARD_KIND_SET.has(value.kind) || typeof value.id !== 'string' ||
      value.id.length > MAX_CARD_REF_ID_LENGTH || !CARD_REF_ID.test(value.id)) {
    throw new TypeError('card reference is invalid');
  }
  if (value.kind === 'system-widget' && !SYSTEM_WIDGET_SET.has(value.id)) {
    throw new TypeError('card reference system widget is invalid');
  }
  return Object.freeze({ kind: value.kind, id: value.id });
}

function cardRefIdentity(input) {
  const card = validateCardRef(input);
  return `${card.kind}:${card.id}`;
}

function cardBoardSupportsCard(boardId, input) {
  if (!BOARD_SET.has(boardId)) return false;
  const card = validateCardRef(input);
  if (card.kind === 'official-category') {
    return boardId === 'browser-catalog' || boardId === 'connect';
  }
  if (card.kind === 'user-collection') {
    return boardId === 'browser-personal' || boardId === 'connect';
  }
  if (card.id === 'ungrouped-favorites') {
    return boardId === 'browser-personal' || boardId === 'connect';
  }
  return boardId === 'connect';
}

function validatePlacement(input) {
  const value = exactKeys(input, [
    'placementId', 'boardId', 'card', 'deckId', 'order', 'size', 'hidden',
  ], 'card placement');
  if (typeof value.placementId !== 'string' || !PLACEMENT_ID.test(value.placementId) ||
      !BOARD_SET.has(value.boardId) || !SIZE_SET.has(value.size) ||
      typeof value.hidden !== 'boolean' ||
      (value.deckId !== null && (typeof value.deckId !== 'string' || !DECK_ID.test(value.deckId)))) {
    throw new TypeError('card placement is invalid');
  }
  const card = validateCardRef(value.card);
  if (!cardBoardSupportsCard(value.boardId, card)) {
    throw new TypeError('card placement board is invalid');
  }
  if (value.hidden && value.deckId !== null) {
    throw new TypeError('hidden card placement cannot belong to a deck');
  }
  return Object.freeze({
    placementId: value.placementId,
    boardId: value.boardId,
    card,
    deckId: value.deckId,
    order: safeInteger(value.order, 'card placement order', { maximum: MAX_CARD_BOARD_PLACEMENTS }),
    size: value.size,
    hidden: value.hidden,
  });
}

function validateDeck(input) {
  const value = exactKeys(input, [
    'deckId', 'boardId', 'placementIds', 'activePlacementId', 'order',
  ], 'card deck');
  if (typeof value.deckId !== 'string' || !DECK_ID.test(value.deckId) ||
      !BOARD_SET.has(value.boardId) || !Array.isArray(value.placementIds) ||
      value.placementIds.length < 2 || value.placementIds.length > MAX_DECK_PLACEMENTS ||
      new Set(value.placementIds).size !== value.placementIds.length ||
      value.placementIds.some((id) => typeof id !== 'string' || !PLACEMENT_ID.test(id)) ||
      typeof value.activePlacementId !== 'string' ||
      !value.placementIds.includes(value.activePlacementId)) {
    throw new TypeError('card deck is invalid');
  }
  return Object.freeze({
    deckId: value.deckId,
    boardId: value.boardId,
    placementIds: Object.freeze([...value.placementIds]),
    activePlacementId: value.activePlacementId,
    order: safeInteger(value.order, 'card deck order', { maximum: MAX_CARD_BOARD_PLACEMENTS }),
  });
}

function validateCanonicalLayout(placements, decks) {
  const placementById = new Map(placements.map((placement) => [placement.placementId, placement]));
  const deckById = new Map(decks.map((deck) => [deck.deckId, deck]));
  for (const placement of placements) {
    if (placement.deckId === null) continue;
    const deck = deckById.get(placement.deckId);
    if (!deck || deck.boardId !== placement.boardId || placement.hidden ||
        !deck.placementIds.includes(placement.placementId)) {
      throw new TypeError('card placement deck is invalid');
    }
  }
  for (const deck of decks) {
    const members = deck.placementIds.map((id) => placementById.get(id));
    if (members.some((member) => !member || member.deckId !== deck.deckId ||
        member.boardId !== deck.boardId || member.hidden)) {
      throw new TypeError('card deck membership is invalid');
    }
    if (members.some((member, index) => member.order !== index)) {
      throw new TypeError('card deck order is not canonical');
    }
  }
  for (const boardId of BOARD_IDS) {
    const units = [
      ...placements.filter((placement) => placement.boardId === boardId && placement.deckId === null),
      ...decks.filter((deck) => deck.boardId === boardId),
    ].sort((left, right) => left.order - right.order);
    if (units.some((unit, index) => unit.order !== index)) {
      throw new TypeError('card board order is not canonical');
    }
  }
}

function validateCardBoardLayoutDocument(input, { resolveCardRef = null } = {}) {
  if (resolveCardRef !== null && typeof resolveCardRef !== 'function') {
    throw new TypeError('card reference resolver is invalid');
  }
  const value = exactKeys(input, ['schemaVersion', 'revision', 'placements', 'decks'],
    'card board layout document');
  if (value.schemaVersion !== CARD_BOARD_SCHEMA_VERSION || !Array.isArray(value.placements) ||
      !Array.isArray(value.decks)) {
    throw new TypeError('card board layout document is invalid');
  }
  if (value.placements.length > MAX_CARD_BOARD_PLACEMENTS) {
    throw new TypeError('card board placement limit is invalid');
  }
  if (value.decks.length > MAX_CARD_BOARD_DECKS) {
    throw new TypeError('card board deck limit is invalid');
  }
  const revision = safeInteger(value.revision, 'card board revision');
  const placements = value.placements.map(validatePlacement);
  const decks = value.decks.map(validateDeck);
  const placementIds = new Set();
  const deckIds = new Set();
  const boardCards = new Set();
  for (const placement of placements) {
    if (placementIds.has(placement.placementId)) {
      throw new TypeError('card placement identity is duplicated');
    }
    placementIds.add(placement.placementId);
    const identity = `${placement.boardId}\0${cardRefIdentity(placement.card)}`;
    if (boardCards.has(identity)) throw new TypeError('card board card is duplicated');
    boardCards.add(identity);
    if (resolveCardRef && resolveCardRef(placement.card, placement.boardId) !== true) {
      throw new TypeError('card reference is unavailable');
    }
  }
  for (const deck of decks) {
    if (deckIds.has(deck.deckId)) throw new TypeError('card deck identity is duplicated');
    deckIds.add(deck.deckId);
  }
  validateCanonicalLayout(placements, decks);
  return Object.freeze({
    schemaVersion: CARD_BOARD_SCHEMA_VERSION,
    revision,
    placements: Object.freeze(placements),
    decks: Object.freeze(decks),
  });
}

function emptyCardBoardLayoutDocument() {
  return validateCardBoardLayoutDocument({
    schemaVersion: CARD_BOARD_SCHEMA_VERSION,
    revision: 0,
    placements: [],
    decks: [],
  });
}

module.exports = {
  BOARD_IDS,
  CARD_BOARD_SCHEMA_VERSION,
  CARD_KINDS,
  MAX_CARD_BOARD_DECKS,
  MAX_CARD_BOARD_PLACEMENTS,
  MAX_DECKS: MAX_CARD_BOARD_DECKS,
  MAX_DECK_PLACEMENTS,
  MAX_PLACEMENTS: MAX_CARD_BOARD_PLACEMENTS,
  SIZE_PRESETS,
  SYSTEM_WIDGET_IDS,
  cardBoardSupportsCard,
  cardRefIdentity,
  emptyCardBoardLayoutDocument,
  parseCardBoardLayoutDocument: validateCardBoardLayoutDocument,
  validateCardBoardLayoutDocument,
  validateCardRef,
};
