(function initializeCardBoardModel(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.cardBoardModel = api;
})(typeof self !== 'undefined' ? self : globalThis, function cardBoardModelFactory() {
  'use strict';

  const BOARD_IDS = Object.freeze(['browser-catalog', 'browser-personal', 'connect']);
  const CARD_SIZES = Object.freeze(['small', 'medium', 'large']);
  const MAX_DECK_DEPTH = 3;

  function boundedString(value, max = 96) {
    return String(value || '').trim().slice(0, max);
  }

  function cardKey(card) {
    return `${boundedString(card?.kind, 32)}:${boundedString(card?.id, 96)}`;
  }

  function columnsForWidth(width) {
    const safeWidth = Math.max(0, Number(width) || 0);
    if (safeWidth < 656) return 1;
    if (safeWidth < 992) return 2;
    if (safeWidth < 1352) return 3;
    return 4;
  }

  function resourceColumnsForWidth(width) {
    return Math.max(0, Number(width) || 0) >= 360 ? 2 : 1;
  }

  function cloneDocument(document) {
    const source = document && typeof document === 'object' ? document : {};
    return {
      schemaVersion: 1,
      revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
      placements: (Array.isArray(source.placements) ? source.placements : []).map((placement) => ({
        placementId: boundedString(placement.placementId, 128),
        boardId: BOARD_IDS.includes(placement.boardId) ? placement.boardId : 'browser-catalog',
        card: {
          kind: boundedString(placement.card?.kind, 32),
          id: boundedString(placement.card?.id, 96),
        },
        deckId: placement.deckId == null ? null : boundedString(placement.deckId, 128),
        order: Number.isSafeInteger(placement.order) ? placement.order : 0,
        size: CARD_SIZES.includes(placement.size) ? placement.size : 'small',
        hidden: placement.hidden === true,
      })).filter((placement) => placement.placementId && placement.card.kind && placement.card.id),
      decks: (Array.isArray(source.decks) ? source.decks : []).map((deck) => ({
        deckId: boundedString(deck.deckId, 128),
        boardId: BOARD_IDS.includes(deck.boardId) ? deck.boardId : 'browser-catalog',
        placementIds: (Array.isArray(deck.placementIds) ? deck.placementIds : [])
          .map((id) => boundedString(id, 128)).filter(Boolean),
        activePlacementId: boundedString(deck.activePlacementId, 128),
        order: Number.isSafeInteger(deck.order) ? deck.order : 0,
      })).filter((deck) => deck.deckId),
    };
  }

  function placementIdFor(boardId, card, existingIds = new Set()) {
    const stem = `placement_${boardId}_${card.kind}_${card.id}`
      .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 78);
    if (!existingIds.has(stem)) return stem;
    let suffix = 2;
    while (existingIds.has(`${stem.slice(0, 76)}-${suffix}`)) suffix += 1;
    return `${stem.slice(0, 76)}-${suffix}`;
  }

  function reconcileBoard(document, boardId, cards) {
    const next = cloneDocument(document);
    const allowed = new Map((Array.isArray(cards) ? cards : [])
      .filter((card) => card && card.kind && card.id)
      .map((card) => [cardKey(card), { kind: card.kind, id: card.id }]));
    const existingIds = new Set(next.placements.map(({ placementId }) => placementId));
    const present = new Set(next.placements
      .filter((placement) => placement.boardId === boardId)
      .map((placement) => cardKey(placement.card)));
    let order = next.placements.filter((placement) => placement.boardId === boardId)
      .reduce((highest, placement) => Math.max(highest, placement.order), -1) + 1;
    for (const [key, card] of allowed) {
      if (present.has(key)) continue;
      const placementId = placementIdFor(boardId, card, existingIds);
      existingIds.add(placementId);
      next.placements.push({
        placementId,
        boardId,
        card,
        deckId: null,
        order: order++,
        size: 'small',
        hidden: false,
      });
    }
    return repairDocument(next);
  }

  function defaultDocument(cardsByBoard = {}) {
    let document = { schemaVersion: 1, revision: 0, placements: [], decks: [] };
    for (const boardId of BOARD_IDS) {
      document = reconcileBoard(document, boardId, cardsByBoard[boardId] || []);
    }
    return document;
  }

  function repairDocument(document) {
    const next = cloneDocument(document);
    const placementById = new Map(next.placements.map((placement) => [placement.placementId, placement]));
    const claimed = new Set();
    next.decks = next.decks.map((deck) => {
      const placementIds = [...new Set(deck.placementIds)]
        .filter((id) => {
          const placement = placementById.get(id);
          if (!placement || placement.boardId !== deck.boardId || claimed.has(id)) return false;
          claimed.add(id);
          placement.deckId = deck.deckId;
          return true;
        });
      const activePlacementId = placementIds.includes(deck.activePlacementId)
        ? deck.activePlacementId : (placementIds[0] || '');
      return { ...deck, placementIds, activePlacementId };
    }).filter((deck) => deck.placementIds.length > 1);
    const validDeckIds = new Set(next.decks.map(({ deckId }) => deckId));
    for (const placement of next.placements) {
      if (!validDeckIds.has(placement.deckId)) placement.deckId = null;
    }
    for (const boardId of BOARD_IDS) reindexBoard(next, boardId);
    return next;
  }

  function reindexBoard(document, boardId) {
    const decks = document.decks.filter((deck) => deck.boardId === boardId)
      .sort((left, right) => left.order - right.order || left.deckId.localeCompare(right.deckId));
    const deckById = new Map(decks.map((deck) => [deck.deckId, deck]));
    const standalone = document.placements.filter((placement) =>
      placement.boardId === boardId && !deckById.has(placement.deckId));
    const units = [
      ...decks.map((deck) => ({ kind: 'deck', id: deck.deckId, order: deck.order })),
      ...standalone.map((placement) => ({ kind: 'placement', id: placement.placementId, order: placement.order })),
    ].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    units.forEach((unit, order) => {
      if (unit.kind === 'deck') deckById.get(unit.id).order = order;
      else {
        const placement = document.placements.find(({ placementId }) => placementId === unit.id);
        if (placement) placement.order = order;
      }
    });
    for (const deck of decks) {
      deck.placementIds.forEach((placementId, order) => {
        const placement = document.placements.find((candidate) => candidate.placementId === placementId);
        if (placement) placement.order = order;
      });
    }
  }

  function boardUnits(document, boardId) {
    const next = repairDocument(document);
    const placementById = new Map(next.placements.map((placement) => [placement.placementId, placement]));
    const decks = next.decks.filter((deck) => deck.boardId === boardId)
      .map((deck) => ({
        kind: 'deck',
        unitId: deck.deckId,
        deck,
        placements: deck.placementIds.map((id) => placementById.get(id))
          .filter((placement) => placement && !placement.hidden),
        order: deck.order,
      })).filter(({ placements }) => placements.length);
    const standalone = next.placements.filter((placement) =>
      placement.boardId === boardId && placement.deckId == null && !placement.hidden)
      .map((placement) => ({
        kind: 'placement',
        unitId: placement.placementId,
        deck: null,
        placements: [placement],
        order: placement.order,
      }));
    return [...decks, ...standalone]
      .sort((left, right) => left.order - right.order || left.unitId.localeCompare(right.unitId));
  }

  function autoStackBoard(document, boardId, depth = MAX_DECK_DEPTH) {
    if (!BOARD_IDS.includes(boardId)) return repairDocument(document);
    const stackDepth = Math.max(2, Math.min(MAX_DECK_DEPTH, Number(depth) || MAX_DECK_DEPTH));
    const next = repairDocument(document);
    const autoPrefix = `auto_${boardId}_`;
    const existingIds = new Set(next.decks.map(({ deckId }) => deckId));
    const automatic = next.decks.filter((deck) => (
      deck.boardId === boardId && deck.deckId.startsWith(autoPrefix) &&
      deck.placementIds.length < stackDepth
    )).sort((left, right) => left.order - right.order);
    const standalone = next.placements.filter((placement) => (
      placement.boardId === boardId && placement.deckId === null && !placement.hidden
    )).sort((left, right) => left.order - right.order ||
      left.placementId.localeCompare(right.placementId));

    while (standalone.length && automatic.length) {
      const deck = automatic[0];
      const placement = standalone.shift();
      placement.deckId = deck.deckId;
      deck.placementIds.push(placement.placementId);
      deck.activePlacementId = placement.placementId;
      if (deck.placementIds.length >= stackDepth) automatic.shift();
    }
    let sequence = next.decks.filter(({ deckId }) => deckId.startsWith(autoPrefix)).length;
    while (standalone.length >= 2) {
      const placements = standalone.splice(0, stackDepth);
      let deckId;
      do { deckId = `${autoPrefix}${sequence++}`; } while (existingIds.has(deckId));
      existingIds.add(deckId);
      placements.forEach((placement) => { placement.deckId = deckId; });
      next.decks.push({
        deckId,
        boardId,
        placementIds: placements.map(({ placementId }) => placementId),
        activePlacementId: placements.at(-1).placementId,
        order: Math.min(...placements.map(({ order }) => order)),
      });
    }
    return repairDocument(next);
  }

  function findPlacement(document, placementId) {
    return document.placements.find((placement) => placement.placementId === placementId) || null;
  }

  function removeFromDeck(document, placement) {
    if (!placement?.deckId) return;
    const deck = document.decks.find(({ deckId }) => deckId === placement.deckId);
    if (deck) deck.placementIds = deck.placementIds.filter((id) => id !== placement.placementId);
    placement.deckId = null;
  }

  function assignBoardUnitOrder(document, boardId, unitIds) {
    const decks = new Map(document.decks.filter((deck) => deck.boardId === boardId)
      .map((deck) => [deck.deckId, deck]));
    const placements = new Map(document.placements.filter((placement) => placement.boardId === boardId)
      .map((placement) => [placement.placementId, placement]));
    unitIds.forEach((unitId, order) => {
      if (decks.has(unitId)) decks.get(unitId).order = order;
      else if (placements.has(unitId)) placements.get(unitId).order = order;
    });
  }

  function insertAt(values, value, index) {
    const next = values.filter((candidate) => candidate !== value);
    next.splice(Math.max(0, Math.min(next.length, Number(index) || 0)), 0, value);
    return next;
  }

  function applyDraftOperation(document, operation = {}) {
    const next = cloneDocument(document);
    const type = boundedString(operation.type, 40);
    const placement = findPlacement(next, operation.placementId || operation.sourcePlacementId);
    if (type === 'move-placement') {
      if (!placement || placement.boardId !== operation.boardId || placement.deckId) return repairDocument(next);
      const unitIds = boardUnits(next, operation.boardId).map(({ unitId }) => unitId);
      assignBoardUnitOrder(next, operation.boardId,
        insertAt(unitIds, placement.placementId, operation.index));
    } else if (type === 'insert-placement') {
      if (!BOARD_IDS.includes(operation.boardId) || !operation.card?.kind || !operation.card?.id) {
        return repairDocument(next);
      }
      const existingIds = new Set(next.placements.map(({ placementId }) => placementId));
      const placementId = placementIdFor(operation.boardId, operation.card, existingIds);
      next.placements.push({
        placementId,
        boardId: operation.boardId,
        card: { kind: operation.card.kind, id: operation.card.id },
        deckId: null,
        order: Number(operation.index) || 0,
        size: CARD_SIZES.includes(operation.size) ? operation.size : 'small',
        hidden: false,
      });
      const unitIds = boardUnits(next, operation.boardId).map(({ unitId }) => unitId);
      assignBoardUnitOrder(next, operation.boardId, insertAt(unitIds, placementId, operation.index));
    } else if (type === 'create-deck') {
      if (!BOARD_IDS.includes(operation.boardId)) return repairDocument(next);
      const placementIds = [...new Set(Array.isArray(operation.placementIds) ? operation.placementIds : [])]
        .filter((id) => {
          const candidate = findPlacement(next, id);
          return candidate && candidate.boardId === operation.boardId;
        });
      if (placementIds.length < 2) return repairDocument(next);
      const deckId = `deck_${operation.boardId}_${placementIds.join('_')}`
        .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 80);
      placementIds.forEach((id) => {
        const candidate = findPlacement(next, id);
        removeFromDeck(next, candidate);
        candidate.deckId = deckId;
      });
      next.decks.push({
        deckId,
        boardId: operation.boardId,
        placementIds,
        activePlacementId: placementIds.includes(operation.activePlacementId)
          ? operation.activePlacementId : placementIds[0],
        order: Number(operation.index) || 0,
      });
      const unitIds = boardUnits(next, operation.boardId).map(({ unitId }) => unitId)
        .filter((id) => !placementIds.includes(id));
      assignBoardUnitOrder(next, operation.boardId, insertAt(unitIds, deckId, operation.index));
    } else if (type === 'move-into-deck') {
      const targetDeck = next.decks.find(({ deckId }) => deckId === operation.deckId);
      if (!placement || !targetDeck || placement.boardId !== targetDeck.boardId) return repairDocument(next);
      removeFromDeck(next, placement);
      placement.deckId = targetDeck.deckId;
      targetDeck.placementIds = insertAt(targetDeck.placementIds, placement.placementId, operation.index);
      targetDeck.activePlacementId = placement.placementId;
    } else if (type === 'remove-from-deck') {
      if (!placement || !placement.deckId) return repairDocument(next);
      const sourceDeck = next.decks.find(({ deckId }) => deckId === placement.deckId);
      const boardId = placement.boardId;
      removeFromDeck(next, placement);
      const unitIds = boardUnits(next, boardId).map(({ unitId }) => unitId);
      assignBoardUnitOrder(next, boardId, insertAt(unitIds, placement.placementId, operation.index));
    } else if (type === 'resize-placement') {
      if (placement && CARD_SIZES.includes(operation.size)) placement.size = operation.size;
    } else if (type === 'pin-to-board') {
      if (!placement) return repairDocument(next);
      const boardId = operation.boardId;
      if (!BOARD_IDS.includes(boardId)) return repairDocument(next);
      const alreadyPinned = next.placements.some((candidate) =>
        candidate.boardId === boardId && cardKey(candidate.card) === cardKey(placement.card));
      if (!alreadyPinned) {
        const existingIds = new Set(next.placements.map(({ placementId }) => placementId));
        next.placements.push({
          ...placement,
          placementId: placementIdFor(boardId, placement.card, existingIds),
          boardId,
          deckId: null,
          order: next.placements.filter((candidate) => candidate.boardId === boardId).length,
          size: CARD_SIZES.includes(operation.size) ? operation.size : 'medium',
          hidden: false,
        });
      }
    } else if (type === 'remove-from-board') {
      if (placement) {
        removeFromDeck(next, placement);
        next.placements = next.placements.filter(({ placementId }) => placementId !== placement.placementId);
      }
    } else if (type === 'hide-placement') {
      if (placement) placement.hidden = operation.hidden !== false;
    } else if (type === 'restore-default-placement') {
      if (placement) {
        removeFromDeck(next, placement);
        placement.hidden = false;
        placement.size = 'small';
        placement.order = next.placements.filter((candidate) =>
          candidate.boardId === placement.boardId && candidate.placementId !== placement.placementId).length;
      }
    }
    return repairDocument(next);
  }

  function applyDraftOperations(document, operations) {
    return (Array.isArray(operations) ? operations : [])
      .reduce((next, operation) => applyDraftOperation(next, operation), cloneDocument(document));
  }

  return Object.freeze({
    BOARD_IDS,
    CARD_SIZES,
    MAX_DECK_DEPTH,
    applyDraftOperation,
    applyDraftOperations,
    autoStackBoard,
    boardUnits,
    cardKey,
    cloneDocument,
    columnsForWidth,
    defaultDocument,
    reconcileBoard,
    repairDocument,
    resourceColumnsForWidth,
  });
});
