'use strict';

const crypto = require('node:crypto');
const {
  BOARD_IDS,
  MAX_CARD_BOARD_DECKS,
  MAX_CARD_BOARD_PLACEMENTS,
  MAX_DECK_PLACEMENTS,
  SIZE_PRESETS,
  SYSTEM_WIDGET_IDS,
  cardBoardSupportsCard,
  cardRefIdentity,
  validateCardBoardLayoutDocument,
  validateCardRef,
} = require('../schema/card-board-contract');

const CONNECT_WIDGET_SET = new Set(SYSTEM_WIDGET_IDS.filter((id) => id !== 'ungrouped-favorites'));
const BOARD_SET = new Set(BOARD_IDS);
const SIZE_SET = new Set(SIZE_PRESETS);
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
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

function normalizedIds(value, kind) {
  if (!Array.isArray(value)) throw new TypeError(`card board ${kind} authority is invalid`);
  const result = [];
  const seen = new Set();
  for (const candidate of value) {
    if (typeof candidate !== 'string' || !SAFE_ID.test(candidate)) {
      throw new TypeError(`card board ${kind} authority is invalid`);
    }
    if (!seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return Object.freeze(result);
}

function normalizeCardBoardAuthority(input) {
  const value = exactKeys(input, [
    'officialCategoryIds', 'userCollectionIds', 'includeUngroupedFavorites', 'connectWidgetIds',
  ], 'card board authority');
  if (typeof value.includeUngroupedFavorites !== 'boolean') {
    throw new TypeError('card board ungrouped authority is invalid');
  }
  const officialCategoryIds = normalizedIds(value.officialCategoryIds, 'official category');
  const userCollectionIds = normalizedIds(value.userCollectionIds, 'user collection');
  const connectWidgetIds = normalizedIds(value.connectWidgetIds, 'connect widget');
  if (connectWidgetIds.some((id) => !CONNECT_WIDGET_SET.has(id))) {
    throw new TypeError('card board connect widget authority is invalid');
  }
  return Object.freeze({
    officialCategoryIds,
    userCollectionIds,
    includeUngroupedFavorites: value.includeUngroupedFavorites,
    connectWidgetIds,
  });
}

function defaultBoardForCard(card) {
  const reference = validateCardRef(card);
  if (reference.kind === 'official-category') return 'browser-catalog';
  if (reference.kind === 'user-collection' || reference.id === 'ungrouped-favorites') {
    return 'browser-personal';
  }
  return 'connect';
}

function defaultSizeForCard(card) {
  const reference = validateCardRef(card);
  if (reference.kind !== 'system-widget' || reference.id === 'ungrouped-favorites') return 'small';
  return reference.id === 'connection-metrics' ? 'medium' : 'large';
}

function authorityCards(input) {
  const authority = normalizeCardBoardAuthority(input);
  return Object.freeze([
    ...authority.officialCategoryIds.map((id) => Object.freeze({
      boardId: 'browser-catalog', card: Object.freeze({ kind: 'official-category', id }),
    })),
    ...authority.userCollectionIds.map((id) => Object.freeze({
      boardId: 'browser-personal', card: Object.freeze({ kind: 'user-collection', id }),
    })),
    ...(authority.includeUngroupedFavorites ? [Object.freeze({
      boardId: 'browser-personal',
      card: Object.freeze({ kind: 'system-widget', id: 'ungrouped-favorites' }),
    })] : []),
    ...authority.connectWidgetIds.map((id) => Object.freeze({
      boardId: 'connect', card: Object.freeze({ kind: 'system-widget', id }),
    })),
  ]);
}

function authorityResolvesCard(input, authorityInput) {
  const card = validateCardRef(input);
  const authority = normalizeCardBoardAuthority(authorityInput);
  if (card.kind === 'official-category') return authority.officialCategoryIds.includes(card.id);
  if (card.kind === 'user-collection') return authority.userCollectionIds.includes(card.id);
  if (card.id === 'ungrouped-favorites') return authority.includeUngroupedFavorites;
  return authority.connectWidgetIds.includes(card.id);
}

function entropyId(prefix, randomBytes, occupied) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    let entropy = randomBytes(12);
    if (!Buffer.isBuffer(entropy) || entropy.length !== 12) {
      entropy?.fill?.(0);
      throw new Error('card board entropy is invalid');
    }
    let candidate;
    try { candidate = `${prefix}_${entropy.toString('hex')}`; }
    finally { entropy.fill(0); entropy = null; }
    if (!occupied.has(candidate)) {
      occupied.add(candidate);
      return candidate;
    }
  }
  throw new Error(`card board ${prefix} identity is unavailable`);
}

function createDefaultCardBoardLayout(authorityInput, {
  randomBytes = crypto.randomBytes,
  revision = 0,
} = {}) {
  if (typeof randomBytes !== 'function' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('card board default dependencies are invalid');
  }
  const occupied = new Set();
  const orders = new Map(BOARD_IDS.map((boardId) => [boardId, 0]));
  const placements = authorityCards(authorityInput).map(({ boardId, card }) => {
    const order = orders.get(boardId);
    orders.set(boardId, order + 1);
    return {
      placementId: entropyId('placement', randomBytes, occupied),
      boardId,
      card,
      deckId: null,
      order,
      size: defaultSizeForCard(card),
      hidden: false,
    };
  });
  return validateCardBoardLayoutDocument({
    schemaVersion: 1,
    revision,
    placements,
    decks: [],
  }, { resolveCardRef: (card) => authorityResolvesCard(card, authorityInput) });
}

function candidatePlacement(value, authority) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.placementId !== 'string' || !PLACEMENT_ID.test(value.placementId) ||
      !BOARD_SET.has(value.boardId) || !Number.isSafeInteger(value.order) || value.order < 0 ||
      !SIZE_SET.has(value.size) || typeof value.hidden !== 'boolean' ||
      (value.deckId !== null && (typeof value.deckId !== 'string' || !DECK_ID.test(value.deckId)))) {
    return null;
  }
  let card;
  try { card = validateCardRef(value.card); } catch { return null; }
  if (!cardBoardSupportsCard(value.boardId, card) || !authorityResolvesCard(card, authority)) return null;
  return {
    placementId: value.placementId,
    boardId: value.boardId,
    card,
    deckId: value.hidden ? null : value.deckId,
    order: value.order,
    size: value.size,
    hidden: value.hidden,
  };
}

function candidateDeck(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.deckId !== 'string' || !DECK_ID.test(value.deckId) ||
      !BOARD_SET.has(value.boardId) || !Array.isArray(value.placementIds) ||
      value.placementIds.length < 2 || value.placementIds.length > MAX_DECK_PLACEMENTS ||
      new Set(value.placementIds).size !== value.placementIds.length ||
      value.placementIds.some((id) => typeof id !== 'string' || !PLACEMENT_ID.test(id)) ||
      typeof value.activePlacementId !== 'string' ||
      !value.placementIds.includes(value.activePlacementId) ||
      !Number.isSafeInteger(value.order) || value.order < 0) return null;
  return {
    deckId: value.deckId,
    boardId: value.boardId,
    placementIds: [...value.placementIds],
    activePlacementId: value.activePlacementId,
    order: value.order,
  };
}

function canonicalize(placementsInput, decksInput) {
  const placements = placementsInput.map((placement) => ({ ...placement, card: { ...placement.card } }));
  const placementById = new Map(placements.map((placement) => [placement.placementId, placement]));
  const claimed = new Set();
  const decks = [];
  for (const candidate of [...decksInput].sort((left, right) => left.order - right.order)) {
    if (decks.some(({ deckId }) => deckId === candidate.deckId)) continue;
    const candidateClaims = [];
    const placementIds = candidate.placementIds.filter((id) => {
      const placement = placementById.get(id);
      if (!placement || placement.boardId !== candidate.boardId || placement.hidden || claimed.has(id)) return false;
      candidateClaims.push(id);
      return true;
    });
    if (placementIds.length < 2) continue;
    candidateClaims.forEach((id) => claimed.add(id));
    const deck = {
      ...candidate,
      placementIds,
      activePlacementId: placementIds.includes(candidate.activePlacementId)
        ? candidate.activePlacementId : placementIds[0],
    };
    placementIds.forEach((id, index) => {
      const placement = placementById.get(id);
      placement.deckId = deck.deckId;
      placement.order = index;
    });
    decks.push(deck);
  }
  for (const placement of placements) {
    if (!claimed.has(placement.placementId)) placement.deckId = null;
  }
  for (const boardId of BOARD_IDS) {
    const units = [
      ...placements.filter((placement) => placement.boardId === boardId && placement.deckId === null)
        .map((placement) => ({ type: 'placement', value: placement })),
      ...decks.filter((deck) => deck.boardId === boardId)
        .map((deck) => ({ type: 'deck', value: deck })),
    ].sort((left, right) => left.value.order - right.value.order ||
      String(left.value.placementId || left.value.deckId)
        .localeCompare(String(right.value.placementId || right.value.deckId)));
    units.forEach(({ value }, order) => { value.order = order; });
  }
  return { placements, decks };
}

function reconcileCardBoardLayout(input, authorityInput, { randomBytes = crypto.randomBytes } = {}) {
  if (typeof randomBytes !== 'function') throw new TypeError('card board reconciliation dependencies are invalid');
  const authority = normalizeCardBoardAuthority(authorityInput);
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 1 ||
      !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      !Array.isArray(input.placements) || input.placements.length > MAX_CARD_BOARD_PLACEMENTS ||
      !Array.isArray(input.decks) || input.decks.length > MAX_CARD_BOARD_DECKS) {
    throw new TypeError('card board layout document is unsupported');
  }
  const placementIds = new Set();
  const boardCards = new Set();
  const placements = [];
  for (const value of input.placements) {
    const placement = candidatePlacement(value, authority);
    if (!placement || placementIds.has(placement.placementId)) continue;
    const boardCard = `${placement.boardId}\0${cardRefIdentity(placement.card)}`;
    if (boardCards.has(boardCard)) continue;
    placementIds.add(placement.placementId);
    boardCards.add(boardCard);
    placements.push(placement);
  }
  const deckIds = new Set();
  const decks = [];
  for (const value of input.decks) {
    const deck = candidateDeck(value);
    if (deck && !deckIds.has(deck.deckId)) {
      deckIds.add(deck.deckId);
      decks.push(deck);
    }
  }
  let layout = canonicalize(placements, decks);
  const occupied = new Set([
    ...layout.placements.map(({ placementId }) => placementId),
    ...layout.decks.map(({ deckId }) => deckId),
  ]);
  for (const { boardId, card } of authorityCards(authority)) {
    const identity = `${boardId}\0${cardRefIdentity(card)}`;
    if (layout.placements.some((placement) =>
      `${placement.boardId}\0${cardRefIdentity(placement.card)}` === identity)) continue;
    const topLevelCount = layout.placements.filter((placement) =>
      placement.boardId === boardId && placement.deckId === null).length +
      layout.decks.filter((deck) => deck.boardId === boardId).length;
    layout.placements.push({
      placementId: entropyId('placement', randomBytes, occupied),
      boardId,
      card,
      deckId: null,
      order: topLevelCount,
      size: defaultSizeForCard(card),
      hidden: false,
    });
  }
  layout = canonicalize(layout.placements, layout.decks);
  return validateCardBoardLayoutDocument({
    schemaVersion: 1,
    revision: input.revision,
    placements: layout.placements,
    decks: layout.decks,
  }, { resolveCardRef: (card) => authorityResolvesCard(card, authority) });
}

function migrateCardBoardLayout(input, authority, options = {}) {
  if (input === null || input === undefined) return createDefaultCardBoardLayout(authority, options);
  return reconcileCardBoardLayout(input, authority, options);
}

module.exports = {
  authorityResolvesCard,
  createDefaultCardBoardLayout,
  defaultBoardForCard,
  defaultSizeForCard,
  migrateCardBoardLayout,
  normalizeCardBoardAuthority,
  reconcileCardBoardLayout,
};
