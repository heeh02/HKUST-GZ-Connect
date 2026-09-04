'use strict';

const crypto = require('node:crypto');
const {
  BOARD_IDS,
  MAX_CARD_BOARD_DECKS,
  MAX_CARD_BOARD_PLACEMENTS,
  MAX_DECK_PLACEMENTS,
  SIZE_PRESETS,
  cardBoardSupportsCard,
  cardRefIdentity,
  validateCardBoardLayoutDocument,
  validateCardRef,
} = require('../schema/card-board-contract');
const {
  authorityResolvesCard,
  createDefaultCardBoardLayout,
  defaultBoardForCard,
  defaultSizeForCard,
  normalizeCardBoardAuthority,
  reconcileCardBoardLayout,
} = require('./card-board-migration');

const MAX_CARD_BOARD_OPERATIONS = 128;
const BOARD_SET = new Set(BOARD_IDS);
const SIZE_SET = new Set(SIZE_PRESETS);

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

function indexValue(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CARD_BOARD_PLACEMENTS) {
    throw new TypeError('card board operation index is invalid');
  }
  return value;
}

function stringValue(value, name) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${name} is invalid`);
  return value;
}

function sizeValue(value) {
  if (!SIZE_SET.has(value)) throw new TypeError('card board operation size is invalid');
  return value;
}

function boardValue(value) {
  if (!BOARD_SET.has(value)) throw new TypeError('card board operation board is invalid');
  return value;
}

function validateOperation(input) {
  const source = plainObject(input, 'card board operation');
  switch (source.type) {
    case 'move-placement': {
      const value = exactKeys(source, ['type', 'placementId', 'boardId', 'index'], 'move placement operation');
      return Object.freeze({ type: value.type, placementId: stringValue(value.placementId, 'placement identity'),
        boardId: boardValue(value.boardId), index: indexValue(value.index) });
    }
    case 'insert-placement': {
      const value = exactKeys(source, ['type', 'boardId', 'card', 'index', 'size'], 'insert placement operation');
      return Object.freeze({ type: value.type, boardId: boardValue(value.boardId),
        card: validateCardRef(value.card), index: indexValue(value.index), size: sizeValue(value.size) });
    }
    case 'create-deck': {
      const value = exactKeys(source, [
        'type', 'boardId', 'placementIds', 'activePlacementId', 'index',
      ], 'create deck operation');
      if (!Array.isArray(value.placementIds) || value.placementIds.length < 2 ||
          value.placementIds.length > MAX_DECK_PLACEMENTS ||
          new Set(value.placementIds).size !== value.placementIds.length ||
          value.placementIds.some((id) => typeof id !== 'string' || !id) ||
          typeof value.activePlacementId !== 'string' ||
          !value.placementIds.includes(value.activePlacementId)) {
        throw new TypeError('create deck operation is invalid');
      }
      return Object.freeze({ type: value.type, boardId: boardValue(value.boardId),
        placementIds: Object.freeze([...value.placementIds]),
        activePlacementId: value.activePlacementId, index: indexValue(value.index) });
    }
    case 'move-into-deck': {
      const value = exactKeys(source, ['type', 'placementId', 'deckId', 'index'], 'move into deck operation');
      return Object.freeze({ type: value.type, placementId: stringValue(value.placementId, 'placement identity'),
        deckId: stringValue(value.deckId, 'deck identity'), index: indexValue(value.index) });
    }
    case 'remove-from-deck': {
      const value = exactKeys(source, ['type', 'placementId', 'index'], 'remove from deck operation');
      return Object.freeze({ type: value.type, placementId: stringValue(value.placementId, 'placement identity'),
        index: indexValue(value.index) });
    }
    case 'resize-placement': {
      const value = exactKeys(source, ['type', 'placementId', 'size'], 'resize placement operation');
      return Object.freeze({ type: value.type, placementId: stringValue(value.placementId, 'placement identity'),
        size: sizeValue(value.size) });
    }
    case 'pin-to-board': {
      const value = exactKeys(source, [
        'type', 'sourcePlacementId', 'boardId', 'index', 'size',
      ], 'pin to board operation');
      return Object.freeze({ type: value.type,
        sourcePlacementId: stringValue(value.sourcePlacementId, 'source placement identity'),
        boardId: boardValue(value.boardId), index: indexValue(value.index), size: sizeValue(value.size) });
    }
    case 'remove-from-board':
    case 'hide-placement':
    case 'restore-default-placement': {
      const value = exactKeys(source, ['type', 'placementId'], `${source.type} operation`);
      return Object.freeze({ type: value.type,
        placementId: stringValue(value.placementId, 'placement identity') });
    }
    default:
      throw new TypeError('card board operation type is invalid');
  }
}

function cloneDocument(document) {
  return {
    schemaVersion: 1,
    revision: document.revision,
    placements: document.placements.map((placement) => ({
      ...placement,
      card: { ...placement.card },
    })),
    decks: document.decks.map((deck) => ({
      ...deck,
      placementIds: [...deck.placementIds],
    })),
  };
}

function placementById(state, placementId) {
  const placement = state.placements.find((candidate) => candidate.placementId === placementId);
  if (!placement) throw new Error('card board placement is unavailable');
  return placement;
}

function deckById(state, deckId) {
  const deck = state.decks.find((candidate) => candidate.deckId === deckId);
  if (!deck) throw new Error('card board deck is unavailable');
  return deck;
}

function unitKey(type, value) {
  return `${type}:${type === 'placement' ? value.placementId : value.deckId}`;
}

function boardUnits(state, boardId) {
  return [
    ...state.placements.filter((placement) => placement.boardId === boardId && placement.deckId === null)
      .map((placement) => ({ type: 'placement', value: placement })),
    ...state.decks.filter((deck) => deck.boardId === boardId)
      .map((deck) => ({ type: 'deck', value: deck })),
  ].sort((left, right) => left.value.order - right.value.order ||
    unitKey(left.type, left.value).localeCompare(unitKey(right.type, right.value)));
}

function assignBoardUnits(state, boardId, units) {
  const unique = new Set();
  units.forEach((unit, order) => {
    const key = unitKey(unit.type, unit.value);
    if (unique.has(key)) throw new Error('card board unit order is duplicated');
    unique.add(key);
    unit.value.order = order;
  });
}

function clampIndex(index, length) {
  return Math.min(index, length);
}

function placeTopLevel(state, placement, index) {
  placement.deckId = null;
  const units = boardUnits(state, placement.boardId)
    .filter((unit) => !(unit.type === 'placement' && unit.value.placementId === placement.placementId));
  units.splice(clampIndex(index, units.length), 0, { type: 'placement', value: placement });
  assignBoardUnits(state, placement.boardId, units);
}

function reorderDeckMembers(state, deck) {
  deck.placementIds.forEach((placementId, order) => {
    const placement = placementById(state, placementId);
    placement.deckId = deck.deckId;
    placement.order = order;
  });
  if (!deck.placementIds.includes(deck.activePlacementId)) {
    deck.activePlacementId = deck.placementIds[0];
  }
}

function detachPlacement(state, placement) {
  const boardId = placement.boardId;
  if (placement.deckId === null) {
    const units = boardUnits(state, boardId).filter((unit) =>
      !(unit.type === 'placement' && unit.value.placementId === placement.placementId));
    placement.order = 0;
    assignBoardUnits(state, boardId, units);
    return;
  }
  const deck = deckById(state, placement.deckId);
  const deckOrder = deck.order;
  deck.placementIds = deck.placementIds.filter((id) => id !== placement.placementId);
  placement.deckId = null;
  placement.order = 0;
  if (deck.placementIds.length >= 2) {
    reorderDeckMembers(state, deck);
    return;
  }
  const remaining = placementById(state, deck.placementIds[0]);
  remaining.deckId = null;
  state.decks = state.decks.filter(({ deckId }) => deckId !== deck.deckId);
  const units = boardUnits(state, boardId)
    .filter((unit) => !(unit.type === 'placement' && unit.value.placementId === placement.placementId));
  const remainingUnit = units.findIndex((unit) =>
    unit.type === 'placement' && unit.value.placementId === remaining.placementId);
  if (remainingUnit !== -1) units.splice(remainingUnit, 1);
  units.splice(clampIndex(deckOrder, units.length), 0, { type: 'placement', value: remaining });
  assignBoardUnits(state, boardId, units);
}

function removePlacement(state, placement) {
  detachPlacement(state, placement);
  state.placements = state.placements.filter(({ placementId }) =>
    placementId !== placement.placementId);
  const units = boardUnits(state, placement.boardId);
  assignBoardUnits(state, placement.boardId, units);
}

function newIdentity(prefix, state, randomBytes) {
  const occupied = new Set([
    ...state.placements.map(({ placementId }) => placementId),
    ...state.decks.map(({ deckId }) => deckId),
  ]);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    let entropy = randomBytes(12);
    if (!Buffer.isBuffer(entropy) || entropy.length !== 12) {
      entropy?.fill?.(0);
      throw new Error('card board entropy is invalid');
    }
    let id;
    try { id = `${prefix}_${entropy.toString('hex')}`; }
    finally { entropy.fill(0); entropy = null; }
    if (!occupied.has(id)) return id;
  }
  throw new Error(`card board ${prefix} identity is unavailable`);
}

function ensureUniqueCard(state, boardId, card) {
  const identity = cardRefIdentity(card);
  if (state.placements.some((placement) => placement.boardId === boardId &&
      cardRefIdentity(placement.card) === identity)) {
    throw new Error('card board already contains this card');
  }
}

function insertPlacement(state, boardId, card, index, size, randomBytes) {
  if (!authorityResolvesCard(card, state.authority) || !cardBoardSupportsCard(boardId, card)) {
    throw new Error('card board card is unavailable on this board');
  }
  ensureUniqueCard(state, boardId, card);
  if (state.placements.length >= MAX_CARD_BOARD_PLACEMENTS) {
    throw new Error('card board placement limit reached');
  }
  const placement = {
    placementId: newIdentity('placement', state, randomBytes),
    boardId,
    card: { ...card },
    deckId: null,
    order: 0,
    size,
    hidden: false,
  };
  state.placements.push(placement);
  placeTopLevel(state, placement, index);
  return placement;
}

function applyOperation(state, operation, randomBytes) {
  switch (operation.type) {
    case 'move-placement': {
      const placement = placementById(state, operation.placementId);
      if (placement.boardId !== operation.boardId) {
        throw new Error('move placement cannot change boards; pin a copy instead');
      }
      detachPlacement(state, placement);
      placeTopLevel(state, placement, operation.index);
      break;
    }
    case 'insert-placement':
      insertPlacement(state, operation.boardId, operation.card, operation.index,
        operation.size, randomBytes);
      break;
    case 'create-deck': {
      if (state.decks.length >= MAX_CARD_BOARD_DECKS) throw new Error('card board deck limit reached');
      const placements = operation.placementIds.map((id) => placementById(state, id));
      if (placements.some((placement) => placement.boardId !== operation.boardId ||
          placement.deckId !== null || placement.hidden)) {
        throw new Error('only visible top-level cards can create a deck');
      }
      const selected = new Set(operation.placementIds);
      const units = boardUnits(state, operation.boardId).filter((unit) =>
        unit.type !== 'placement' || !selected.has(unit.value.placementId));
      const deck = {
        deckId: newIdentity('deck', state, randomBytes),
        boardId: operation.boardId,
        placementIds: [...operation.placementIds],
        activePlacementId: operation.activePlacementId,
        order: 0,
      };
      state.decks.push(deck);
      reorderDeckMembers(state, deck);
      units.splice(clampIndex(operation.index, units.length), 0, { type: 'deck', value: deck });
      assignBoardUnits(state, operation.boardId, units);
      break;
    }
    case 'move-into-deck': {
      const placement = placementById(state, operation.placementId);
      const target = deckById(state, operation.deckId);
      if (placement.boardId !== target.boardId || placement.hidden) {
        throw new Error('card board deck target is incompatible');
      }
      if (placement.deckId === target.deckId) {
        const members = target.placementIds.filter((id) => id !== placement.placementId);
        members.splice(clampIndex(operation.index, members.length), 0, placement.placementId);
        target.placementIds = members;
        reorderDeckMembers(state, target);
        break;
      }
      if (target.placementIds.length >= MAX_DECK_PLACEMENTS) {
        throw new Error('card board deck placement limit reached');
      }
      detachPlacement(state, placement);
      const targetAfterDetach = deckById(state, operation.deckId);
      targetAfterDetach.placementIds.splice(
        clampIndex(operation.index, targetAfterDetach.placementIds.length), 0, placement.placementId,
      );
      reorderDeckMembers(state, targetAfterDetach);
      break;
    }
    case 'remove-from-deck': {
      const placement = placementById(state, operation.placementId);
      if (placement.deckId === null) throw new Error('card board placement is not in a deck');
      detachPlacement(state, placement);
      placeTopLevel(state, placement, operation.index);
      break;
    }
    case 'resize-placement':
      placementById(state, operation.placementId).size = operation.size;
      break;
    case 'pin-to-board': {
      const source = placementById(state, operation.sourcePlacementId);
      if (source.boardId === 'connect' || source.hidden || operation.boardId !== 'connect') {
        throw new Error('card board pins must copy a browser card to connect');
      }
      insertPlacement(state, operation.boardId, source.card, operation.index,
        operation.size, randomBytes);
      break;
    }
    case 'remove-from-board': {
      const placement = placementById(state, operation.placementId);
      if (placement.boardId !== 'connect' ||
          (placement.card.kind === 'system-widget' && placement.card.id !== 'ungrouped-favorites')) {
        throw new Error('only a connect board pin can be removed; hide a default card instead');
      }
      removePlacement(state, placement);
      break;
    }
    case 'hide-placement': {
      const placement = placementById(state, operation.placementId);
      detachPlacement(state, placement);
      placement.hidden = true;
      placeTopLevel(state, placement, boardUnits(state, placement.boardId).length);
      break;
    }
    case 'restore-default-placement': {
      const placement = placementById(state, operation.placementId);
      const defaultBoard = defaultBoardForCard(placement.card);
      if (placement.boardId !== defaultBoard) {
        throw new Error('only a default placement can be restored');
      }
      detachPlacement(state, placement);
      placement.hidden = false;
      placement.size = defaultSizeForCard(placement.card);
      const defaults = state.defaultCards.filter(({ boardId }) => boardId === defaultBoard)
        .map(({ card }) => cardRefIdentity(card));
      const defaultIndex = defaults.indexOf(cardRefIdentity(placement.card));
      placeTopLevel(state, placement, defaultIndex === -1
        ? boardUnits(state, defaultBoard).length : defaultIndex);
      break;
    }
    default:
      throw new TypeError('card board operation type is invalid');
  }
}

function defaultCardsForAuthority(authority) {
  return [
    ...authority.officialCategoryIds.map((id) => ({
      boardId: 'browser-catalog', card: { kind: 'official-category', id },
    })),
    ...authority.userCollectionIds.map((id) => ({
      boardId: 'browser-personal', card: { kind: 'user-collection', id },
    })),
    ...(authority.includeUngroupedFavorites ? [{
      boardId: 'browser-personal',
      card: { kind: 'system-widget', id: 'ungrouped-favorites' },
    }] : []),
    ...authority.connectWidgetIds.map((id) => ({
      boardId: 'connect', card: { kind: 'system-widget', id },
    })),
  ];
}

function applyCardBoardOperations(document, operations, authorityInput, {
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!Array.isArray(operations) || !operations.length ||
      operations.length > MAX_CARD_BOARD_OPERATIONS || typeof randomBytes !== 'function') {
    throw new TypeError('card board operation batch is invalid');
  }
  const authority = normalizeCardBoardAuthority(authorityInput);
  const source = reconcileCardBoardLayout(document, authority, { randomBytes });
  const state = cloneDocument(source);
  state.authority = authority;
  state.defaultCards = defaultCardsForAuthority(authority);
  for (const input of operations) {
    const operation = validateOperation(input);
    applyOperation(state, operation, randomBytes);
  }
  return validateCardBoardLayoutDocument({
    schemaVersion: 1,
    revision: source.revision,
    placements: state.placements,
    decks: state.decks,
  }, { resolveCardRef: (card) => authorityResolvesCard(card, authority) });
}

function revisionConflict(expected, actual) {
  const error = new Error(`card board revision conflict: expected ${expected}, current ${actual}`);
  error.code = 'CARD_BOARD_REVISION_CONFLICT';
  error.expectedRevision = expected;
  error.currentRevision = actual;
  return error;
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

class CardBoardRuntime {
  constructor({ store, randomBytes = crypto.randomBytes } = {}) {
    if (!store || typeof store.read !== 'function' || typeof store.replace !== 'function' ||
        typeof randomBytes !== 'function') {
      throw new TypeError('card board runtime dependencies are invalid');
    }
    this.store = store;
    this.randomBytes = randomBytes;
    this.running = false;
  }

  snapshot(authority) {
    return this.#singleFlight(() => this.#load(authority));
  }

  commit(input, authority) {
    return this.#singleFlight(() => {
      const payload = exactKeys(input, ['baseRevision', 'operations'], 'card board commit');
      if (!Number.isSafeInteger(payload.baseRevision) || payload.baseRevision < 0) {
        throw new TypeError('card board base revision is invalid');
      }
      const loaded = this.#load(authority);
      const current = loaded.document;
      if (payload.baseRevision !== current.revision) {
        throw revisionConflict(payload.baseRevision, current.revision);
      }
      const candidate = applyCardBoardOperations(current, payload.operations, authority, {
        randomBytes: this.randomBytes,
      });
      if (sameDocument(candidate, current)) return Object.freeze({ document: current, changed: false });
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('card board revision is exhausted');
      const next = validateCardBoardLayoutDocument({
        ...candidate,
        revision: current.revision + 1,
      }, { resolveCardRef: (card) => authorityResolvesCard(card, authority) });
      this.store.replace(next);
      return Object.freeze({ document: next, changed: true });
    });
  }

  reset(input, authority) {
    return this.#singleFlight(() => {
      const payload = exactKeys(input, ['baseRevision'], 'card board reset');
      if (!Number.isSafeInteger(payload.baseRevision) || payload.baseRevision < 0) {
        throw new TypeError('card board base revision is invalid');
      }
      const current = this.#load(authority).document;
      if (payload.baseRevision !== current.revision) {
        throw revisionConflict(payload.baseRevision, current.revision);
      }
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('card board revision is exhausted');
      const next = createDefaultCardBoardLayout(authority, {
        randomBytes: this.randomBytes,
        revision: current.revision + 1,
      });
      this.store.replace(next);
      return Object.freeze({ document: next, changed: true });
    });
  }

  #load(authority) {
    normalizeCardBoardAuthority(authority);
    const stored = this.store.read();
    if (stored === null) {
      const initial = createDefaultCardBoardLayout(authority, { randomBytes: this.randomBytes });
      this.store.replace(initial);
      return Object.freeze({ document: initial, changed: true });
    }
    const reconciled = reconcileCardBoardLayout(stored, authority, { randomBytes: this.randomBytes });
    if (sameDocument(reconciled, stored)) {
      return Object.freeze({ document: stored, changed: false });
    }
    if (stored.revision === Number.MAX_SAFE_INTEGER) throw new Error('card board revision is exhausted');
    const next = validateCardBoardLayoutDocument({
      ...reconciled,
      revision: stored.revision + 1,
    }, { resolveCardRef: (card) => authorityResolvesCard(card, authority) });
    this.store.replace(next);
    return Object.freeze({ document: next, changed: true });
  }

  #singleFlight(callback) {
    if (this.running) throw new Error('card board runtime operation is already running');
    this.running = true;
    try { return callback(); }
    finally { this.running = false; }
  }
}

module.exports = {
  CardBoardRuntime,
  MAX_CARD_BOARD_OPERATIONS,
  applyCardBoardOperations,
  validateCardBoardOperation: validateOperation,
};
