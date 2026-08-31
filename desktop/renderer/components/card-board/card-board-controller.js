(function initializeCardBoardController(root, factory) {
  const api = factory(
    typeof module !== 'undefined' && module.exports ? require('./card-board-model') : root.cardBoardModel,
    typeof module !== 'undefined' && module.exports ? require('./card-board-view') : root.cardBoardView,
    typeof module !== 'undefined' && module.exports ? require('./card-board-drag') : root.cardBoardDrag,
    typeof module !== 'undefined' && module.exports ? require('./card-board-adapter') : root.cardBoardAdapter,
    typeof module !== 'undefined' && module.exports ? require('./card-board-motion') : root.cardBoardMotion,
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.cardBoardController = api;
})(typeof self !== 'undefined' ? self : globalThis, function cardBoardControllerFactory(model, view, drag, adapterTools, motion) {
  'use strict';

  if (!model || !view || !drag || !adapterTools || !motion) throw new TypeError('card board dependencies are required');
  const { createMemoryAdapter, localeStrings, normalizeAdapter, resultDocument } = adapterTools;

  function unitIndexForPlacement(document, placementId) {
    const placement = document.placements.find((candidate) => candidate.placementId === placementId);
    if (!placement) return -1;
    const unitId = placement.deckId || placement.placementId;
    return model.boardUnits(document, placement.boardId).findIndex((unit) => unit.unitId === unitId);
  }

  function dropOperationsForDocument(document, { sourcePlacementId, targetPlacementId, position }) {
    const source = document.placements.find(({ placementId }) => placementId === sourcePlacementId);
    const target = document.placements.find(({ placementId }) => placementId === targetPlacementId);
    if (!source || !target || source.boardId !== target.boardId || source.placementId === target.placementId) return [];
    const targetUnitIndex = unitIndexForPlacement(document, targetPlacementId);
    if (position === 'stack') {
      if (target.deckId) {
        const deck = document.decks.find(({ deckId }) => deckId === target.deckId);
        const index = Math.max(0, deck?.placementIds.indexOf(targetPlacementId) ?? 0) + 1;
        return [{ type: 'move-into-deck', placementId: sourcePlacementId, deckId: target.deckId, index }];
      }
      const create = {
        type: 'create-deck',
        boardId: target.boardId,
        placementIds: [targetPlacementId, sourcePlacementId],
        activePlacementId: sourcePlacementId,
        index: Math.max(0, targetUnitIndex),
      };
      return source.deckId
        ? [{ type: 'remove-from-deck', placementId: sourcePlacementId, index: Math.max(0, targetUnitIndex) }, create]
        : [create];
    }
    const sourceUnitIndex = unitIndexForPlacement(document, sourcePlacementId);
    const targetIndexAfterDetach = targetUnitIndex - (
      source.deckId === null && sourceUnitIndex >= 0 && sourceUnitIndex < targetUnitIndex ? 1 : 0
    );
    const index = Math.max(0, targetIndexAfterDetach + (position === 'after' ? 1 : 0));
    return source.deckId
      ? [{ type: 'remove-from-deck', placementId: sourcePlacementId, index }]
      : [{ type: 'move-placement', placementId: sourcePlacementId, boardId: source.boardId, index }];
  }

  function create(options = {}) {
    const {
      container,
      boardId,
      escapeHtml,
      translate,
      manageButton = null,
      toolbar = null,
      adapter: requestedAdapter = null,
      autoPlace = boardId !== 'connect',
      onDocument = null,
      onEditingChange = null,
      announce = null,
      toast = null,
      externalDropTargets = [],
    } = options;
    if (!container || !model.BOARD_IDS.includes(boardId) || typeof escapeHtml !== 'function' ||
        typeof translate !== 'function') {
      throw new TypeError('card board controller dependencies are incomplete');
    }

    let categories = [];
    let cardsByKey = new Map();
    let query = '';
    let documentState = model.defaultDocument();
    let draftDocument = null;
    let baseDocument = null;
    let operations = [];
    let history = [];
    let historyIndex = -1;
    let editing = false;
    let resetRequested = false;
    let expandedByDeck = {};
    let frontByDeck = {};
    const expandedAll = new Set();
    let columns = model.columnsForWidth(container.getBoundingClientRect().width);
    let availableHeight = motion.availableHeight(container);
    let destroyed = false;
    let dragFeature = null;
    let responsiveFeature = null;
    const hasExternalAdapter = [requestedAdapter?.get, requestedAdapter?.commit, requestedAdapter?.reset]
      .every((method) => typeof method === 'function');
    const adapter = normalizeAdapter(requestedAdapter, documentState);

    const liveDocument = () => editing ? draftDocument : documentState;
    const strings = () => localeStrings(container.ownerDocument);

    function announceMessage(message) {
      if (typeof announce === 'function') announce(message);
      const live = container.ownerDocument.getElementById('cardBoardLiveRegion');
      if (live) live.textContent = message || '';
    }

    function reconcile(document) {
      return autoPlace
        ? model.reconcileBoard(document, boardId, categories.map(({ kind, id }) => ({ kind, id })))
        : model.repairDocument(document);
    }

    function renderToolbar() {
      if (!toolbar) return;
      toolbar.hidden = !editing;
      if (!editing) {
        toolbar.replaceChildren();
        return;
      }
      const labels = strings();
      toolbar.innerHTML = `<button type="button" data-board-action="undo"${historyIndex <= 0 ? ' disabled' : ''}>${escapeHtml(labels.undo)}</button>`
        + `<button type="button" data-board-action="redo"${historyIndex >= history.length - 1 ? ' disabled' : ''}>${escapeHtml(labels.redo)}</button>`
        + `<button type="button" data-board-action="reset">${escapeHtml(labels.reset)}</button>`
        + `<span class="cb-toolbar-spacer"></span><button type="button" data-board-action="cancel">${escapeHtml(labels.cancel)}</button>`
        + `<button class="cb-toolbar-primary" type="button" data-board-action="done">${escapeHtml(labels.done)}</button>`;
    }

    function render({ preserveFocus = true, animate = false } = {}) {
      if (destroyed) return;
      const previousRects = animate ? motion.placementRects(container) : null;
      const focusedPlacementId = preserveFocus
        ? container.ownerDocument.activeElement?.closest?.('[data-card-placement-id]')?.dataset.cardPlacementId : null;
      const current = reconcile(liveDocument());
      const logicalUnits = model.boardUnits(current, boardId).map((unit) => ({
        ...unit,
        placements: unit.placements.filter((placement) => cardsByKey.has(model.cardKey(placement.card))),
      })).filter(({ placements }) => placements.length);
      availableHeight = motion.availableHeight(container);
      const presentation = model.dealUnits(logicalUnits, { columns, availableHeight });
      const context = {
        boardId,
        units: presentation.units,
        cardsByKey,
        expandedByDeck,
        frontByDeck,
        expandedAll,
        editing,
        escapeHtml,
        translate,
        strings: strings(),
        columns,
        rows: presentation.capacity.rows,
        pinnedCardKeys: new Set(current.placements
          .filter((placement) => placement.boardId === 'connect' && !placement.hidden)
          .map((placement) => model.cardKey(placement.card))),
      };
      container.innerHTML = query.trim()
        ? view.renderSearch(categories, query, context)
        : view.renderBoard(context);
      container.style.setProperty('--cb-columns', String(columns));
      container.dataset.cardBoardSlots = String(presentation.capacity.slotCount);
      renderToolbar();
      if (manageButton) {
        manageButton.textContent = editing ? strings().done : strings().edit;
        manageButton.setAttribute('aria-pressed', String(editing));
      }
      if (focusedPlacementId) {
        const focusedCard = [...container.querySelectorAll('[data-card-placement-id]')]
          .find((card) => card.dataset.cardPlacementId === focusedPlacementId);
        const focusTarget = editing ? focusedCard : focusedCard?.querySelector('[data-card-action="toggle"]');
        focusTarget?.focus({ preventScroll: true });
      }
      motion.animateFrom(container, previousRects);
    }

    function pushDraft(nextDocument, nextOperations, message = strings().draftChanged) {
      if (!editing) return;
      history = history.slice(0, historyIndex + 1);
      history.push({ document: model.cloneDocument(nextDocument), operations: [...nextOperations] });
      historyIndex = history.length - 1;
      draftDocument = history[historyIndex].document;
      operations = history[historyIndex].operations;
      resetRequested = false;
      render();
      announceMessage(message);
    }

    function applyOperations(nextOperations) {
      const bounded = (Array.isArray(nextOperations) ? nextOperations : [nextOperations]).filter(Boolean);
      if (!bounded.length) return;
      const nextDocument = model.applyDraftOperations(draftDocument, bounded);
      pushDraft(nextDocument, [...operations, ...bounded]);
    }

    function enterEdit() {
      if (editing) return;
      editing = true;
      baseDocument = reconcile(documentState);
      draftDocument = model.cloneDocument(baseDocument);
      operations = [];
      history = [{ document: model.cloneDocument(draftDocument), operations: [] }];
      historyIndex = 0;
      resetRequested = false;
      onEditingChange?.(true);
      render({ preserveFocus: false });
      container.querySelector('[data-card-drag-handle]')?.focus();
    }

    function cancelEdit() {
      if (!editing) return;
      editing = false;
      draftDocument = null;
      baseDocument = null;
      history = [];
      historyIndex = -1;
      operations = [];
      resetRequested = false;
      dragFeature?.cancel();
      onEditingChange?.(false);
      render({ preserveFocus: false });
      manageButton?.focus({ preventScroll: true });
    }

    async function finishEdit() {
      if (!editing) return true;
      const labels = strings();
      if (!operations.length && !resetRequested) {
        editing = false;
        draftDocument = null;
        baseDocument = null;
        history = [];
        historyIndex = -1;
        onEditingChange?.(false);
        render({ preserveFocus: false });
        manageButton?.focus({ preventScroll: true });
        return true;
      }
      manageButton && (manageButton.disabled = true);
      toolbar?.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      try {
        const result = hasExternalAdapter
          ? (resetRequested
            ? await adapter.reset({ baseRevision: baseDocument.revision })
            : await adapter.commit({ baseRevision: baseDocument.revision, operations: [...operations] }))
          : null;
        const committed = resultDocument(result) || {
          ...model.cloneDocument(draftDocument),
          revision: baseDocument.revision + (operations.length || resetRequested ? 1 : 0),
        };
        documentState = reconcile(committed);
        editing = false;
        draftDocument = null;
        baseDocument = null;
        operations = [];
        history = [];
        historyIndex = -1;
        resetRequested = false;
        onDocument?.(model.cloneDocument(documentState));
        onEditingChange?.(false);
        render({ preserveFocus: false });
        announceMessage(labels.saved);
        toast?.(labels.saved, 'success');
        manageButton?.focus({ preventScroll: true });
        return true;
      } catch (error) {
        const message = error?.code === 'CARD_BOARD_REVISION_CONFLICT' ? labels.stale : labels.saveFailed;
        toast?.(message, 'error');
        announceMessage(message);
        return false;
      } finally {
        if (manageButton) manageButton.disabled = false;
        renderToolbar();
      }
    }

    function toggleEdit() {
      if (editing) return finishEdit();
      enterEdit();
      return Promise.resolve(true);
    }

    function dropOperations({ sourcePlacementId, targetPlacementId, position }) {
      return dropOperationsForDocument(draftDocument, {
        sourcePlacementId, targetPlacementId, position,
      });
    }

    function onDrop(payload) {
      applyOperations(dropOperations(payload));
    }

    function onKeyboardMove({ placementId, direction }) {
      if (!editing) return;
      const placement = draftDocument.placements.find((candidate) => candidate.placementId === placementId);
      if (!placement) return;
      const currentIndex = unitIndexForPlacement(draftDocument, placementId);
      const delta = direction === 'ArrowLeft' || direction === 'ArrowUp' ? -1 : 1;
      const index = Math.max(0, currentIndex + delta);
      const nextOperation = placement.deckId
        ? { type: 'remove-from-deck', placementId, index }
        : { type: 'move-placement', placementId, boardId: placement.boardId, index };
      applyOperations(nextOperation);
      announceMessage(`已移动到第 ${index + 1} 位`);
    }

    function onExternalDrop({ sourcePlacementId, boardId: targetBoardId }) {
      if (!editing || targetBoardId !== 'connect' || boardId === 'connect') return;
      applyOperations({
        type: 'pin-to-board',
        sourcePlacementId,
        boardId: 'connect',
        index: model.boardUnits(draftDocument, 'connect').length,
        size: 'medium',
      });
      announceMessage(strings().pinToConnect);
    }

    function cardForPlacement(placementId) {
      const placement = liveDocument().placements.find((candidate) => candidate.placementId === placementId);
      return placement ? cardsByKey.get(model.cardKey(placement.card)) : null;
    }

    function focusCard(kind, id) {
      const placement = liveDocument().placements.find((candidate) =>
        candidate.boardId === boardId && candidate.card.kind === kind && candidate.card.id === id && !candidate.hidden);
      if (!placement) return false;
      const visibleCard = [...container.querySelectorAll('[data-card-placement-id]')]
        .find((card) => card.dataset.cardPlacementId === placement.placementId);
      const deckId = visibleCard?.closest('[data-card-deck-id]')?.dataset.cardDeckId
        || placement.deckId || placement.placementId;
      frontByDeck = { ...frontByDeck, [deckId]: placement.placementId };
      expandedByDeck = { ...expandedByDeck, [deckId]: placement.placementId };
      render({ preserveFocus: false, animate: true });
      const target = [...container.querySelectorAll('[data-card-placement-id]')]
        .find((card) => card.dataset.cardPlacementId === placement.placementId);
      motion.scrollPlacementIntoView(container, placement.placementId);
      target?.querySelector('[data-card-action="toggle"]')?.focus({ preventScroll: true });
      return true;
    }

    function handleClick(event) {
      const placementElement = event.target.closest('[data-card-placement-id]');
      const placementId = placementElement?.dataset.cardPlacementId;
      if (event.target.closest('[data-card-action="toggle"]') && placementId) {
        const deckId = placementElement.closest('[data-card-deck-id]')?.dataset.cardDeckId || placementId;
        frontByDeck = { ...frontByDeck, [deckId]: placementId };
        expandedByDeck = model.toggleExpandedPlacement(expandedByDeck, deckId, placementId);
        render({ animate: true });
        return;
      }
      if (event.target.closest('[data-card-action="expand-all"]') && placementId) {
        expandedAll.add(placementId);
        render();
        return;
      }
      const editAction = event.target.closest('[data-card-edit-action]')?.dataset.cardEditAction;
      if (!editing || !placementId || !editAction) return;
      const placement = draftDocument.placements.find((candidate) => candidate.placementId === placementId);
      if (!placement) return;
      if (editAction === 'resize') {
        const size = event.target.closest('[data-card-next-size]')?.dataset.cardNextSize;
        applyOperations({ type: 'resize-placement', placementId, size });
      } else if (editAction === 'pin') {
        applyOperations({
          type: 'pin-to-board',
          sourcePlacementId: placementId,
          boardId: 'connect',
          index: model.boardUnits(draftDocument, 'connect').length,
          size: 'medium',
        });
      } else if (editAction === 'remove') {
        applyOperations(placement.boardId === 'connect'
          ? { type: 'remove-from-board', placementId }
          : { type: 'hide-placement', placementId });
      }
    }

    async function handleToolbarClick(event) {
      const action = event.target.closest('[data-board-action]')?.dataset.boardAction;
      if (!action || !editing) return;
      if (action === 'undo' && historyIndex > 0) {
        historyIndex -= 1;
        draftDocument = model.cloneDocument(history[historyIndex].document);
        operations = [...history[historyIndex].operations];
        resetRequested = false;
        render();
      } else if (action === 'redo' && historyIndex < history.length - 1) {
        historyIndex += 1;
        draftDocument = model.cloneDocument(history[historyIndex].document);
        operations = [...history[historyIndex].operations];
        resetRequested = false;
        render();
      } else if (action === 'reset') {
        const restore = draftDocument.placements
          .filter((placement) => placement.boardId === boardId)
          .map(({ placementId }) => ({ type: 'restore-default-placement', placementId }));
        applyOperations(restore);
      } else if (action === 'cancel') cancelEdit();
      else if (action === 'done') await finishEdit();
    }

    function setData(next = {}) {
      categories = (Array.isArray(next.categories) ? next.categories : []).map((category) => ({
        ...category,
        kind: category.kind || 'official-category',
        items: Array.isArray(category.items) ? category.items : [],
      }));
      cardsByKey = new Map(categories.map((category) => [`${category.kind}:${category.id}`, category]));
      query = String(next.query || '').trim();
      documentState = reconcile(documentState);
      if (editing) {
        draftDocument = reconcile(draftDocument);
        history[historyIndex] = { document: model.cloneDocument(draftDocument), operations: [...operations] };
      }
      render();
    }

    function setDocument(nextDocument) {
      if (!nextDocument || editing) return false;
      documentState = reconcile(nextDocument);
      render();
      return true;
    }

    async function load() {
      if (!hasExternalAdapter) return model.cloneDocument(documentState);
      try {
        const result = await adapter.get();
        const loaded = resultDocument(result);
        if (loaded && !editing) {
          documentState = reconcile(loaded);
          onDocument?.(model.cloneDocument(documentState));
          render({ preserveFocus: false });
        }
      } catch {
        // The memory document is already visible; persistence failures must not
        // make campus resources unavailable.
      }
      return model.cloneDocument(documentState);
    }

    container.addEventListener('click', handleClick);
    toolbar?.addEventListener('click', handleToolbarClick);
    manageButton?.addEventListener('click', toggleEdit);
    dragFeature = drag.attach({
      container,
      onDrop,
      onKeyboardMove,
      onExternalDrop,
      externalTargets: externalDropTargets,
      announce: announceMessage,
    });
    responsiveFeature = motion.observeResponsive({
      container,
      model,
      current: () => ({ columns, availableHeight }),
      onChange: (next) => {
        columns = next.columns;
        availableHeight = next.availableHeight;
        if (!next.measureOnly) render({ animate: next.animate === true });
      },
    });

    return Object.freeze({
      cancelEdit,
      destroy() {
        destroyed = true;
        responsiveFeature?.destroy();
        dragFeature?.destroy();
        container.removeEventListener('click', handleClick);
        toolbar?.removeEventListener('click', handleToolbarClick);
        manageButton?.removeEventListener('click', toggleEdit);
      },
      enterEdit,
      finishEdit,
      focusCard,
      isEditing: () => editing,
      load,
      render,
      setData,
      setDocument,
      snapshot: () => model.cloneDocument(liveDocument()),
      toggleEdit,
      cardForPlacement,
    });
  }

  return Object.freeze({
    create,
    createMemoryAdapter,
    dropOperationsForDocument,
    localeStrings,
    resultDocument,
  });
});
