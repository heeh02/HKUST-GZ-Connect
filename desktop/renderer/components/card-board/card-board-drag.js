(function initializeCardBoardDrag(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.cardBoardDrag = api;
})(typeof self !== 'undefined' ? self : globalThis, function cardBoardDragFactory() {
  'use strict';

  function dropPosition(card, clientY) {
    const rect = card.getBoundingClientRect();
    const ratio = rect.height ? (clientY - rect.top) / rect.height : 0.5;
    if (ratio < 0.24) return 'before';
    if (ratio > 0.76) return 'after';
    return 'stack';
  }

  function attach({ container, onDrop, onKeyboardMove, onExternalDrop, externalTargets = [], announce } = {}) {
    if (!container || typeof onDrop !== 'function') {
      throw new TypeError('card board drag dependencies are incomplete');
    }
    let draggedPlacementId = null;
    let dropCard = null;
    let keyboardPlacementId = null;
    let externalTarget = null;

    function editingMode() {
      if (container.dataset?.editing != null) return container.dataset.editing === 'true';
      return container.matches?.('[data-card-board]')
        ? container.dataset.editing === 'true'
        : container.querySelector?.('[data-card-board]')?.dataset.editing === 'true';
    }

    function clearDropTarget() {
      if (dropCard) {
        delete dropCard.dataset.cardDropTarget;
        dropCard = null;
      }
      if (externalTarget) {
        delete externalTarget.node.dataset.cardExternalDrop;
        externalTarget = null;
      }
    }

    function clearDragging() {
      clearDropTarget();
      if (draggedPlacementId) {
        const source = [...container.querySelectorAll('[data-card-placement-id]')]
          .find((candidate) => candidate.dataset.cardPlacementId === draggedPlacementId);
        if (source) source.dataset.dragging = 'false';
      }
      container.classList.remove('cb-is-dragging');
      draggedPlacementId = null;
    }

    function onDragStart(event) {
      const handle = event.target.closest('[data-card-drag-handle]');
      const card = handle?.closest('[data-card-placement-id]');
      const interactive = event.target.closest(
        '.cb-icon-action, .cb-site-open, .resource-favorite, .cb-expand-all',
      );
      if (!card || interactive || !editingMode()) {
        event.preventDefault();
        return;
      }
      draggedPlacementId = card.dataset.cardPlacementId;
      card.dataset.dragging = 'true';
      container.classList.add('cb-is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedPlacementId);
    }

    function onDragOver(event) {
      if (!draggedPlacementId) return;
      const card = event.target.closest('[data-card-placement-id]');
      if (!card || card.dataset.cardPlacementId === draggedPlacementId) {
        clearDropTarget();
        return;
      }
      event.preventDefault();
      const position = dropPosition(card, event.clientY);
      if (dropCard !== card) clearDropTarget();
      dropCard = card;
      card.dataset.cardDropTarget = position;
      event.dataTransfer.dropEffect = 'move';
    }

    function onDropEvent(event) {
      if (!draggedPlacementId || !dropCard) return;
      event.preventDefault();
      const targetPlacementId = dropCard.dataset.cardPlacementId;
      const position = dropCard.dataset.cardDropTarget || 'stack';
      const sourcePlacementId = draggedPlacementId;
      clearDragging();
      onDrop({ sourcePlacementId, targetPlacementId, position });
    }

    function externalTargetFor(node) {
      if (!node?.closest) return null;
      for (const target of externalTargets) {
        const candidate = node.closest(target.selector);
        if (candidate) return { node: candidate, boardId: target.boardId };
      }
      return null;
    }

    function onDocumentDragOver(event) {
      if (!draggedPlacementId) return;
      const next = externalTargetFor(event.target);
      if (!next) {
        if (externalTarget) {
          delete externalTarget.node.dataset.cardExternalDrop;
          externalTarget = null;
        }
        return;
      }
      event.preventDefault();
      if (externalTarget?.node !== next.node) clearDropTarget();
      externalTarget = next;
      next.node.dataset.cardExternalDrop = 'true';
      event.dataTransfer.dropEffect = 'copy';
    }

    function onDocumentDrop(event) {
      if (!draggedPlacementId) return;
      const target = externalTargetFor(event.target) || externalTarget;
      if (!target) return;
      event.preventDefault();
      const sourcePlacementId = draggedPlacementId;
      const boardId = target.boardId;
      clearDragging();
      onExternalDrop?.({ sourcePlacementId, boardId });
    }

    function setKeyboardPicked(placementId) {
      keyboardPlacementId = placementId || null;
      container.querySelectorAll('[data-card-placement-id]').forEach((card) => {
        const picked = card.dataset.cardPlacementId === keyboardPlacementId;
        card.dataset.keyboardPicked = String(picked);
        const handle = card.matches?.('[data-card-drag-handle]')
          ? card : card.querySelector('[data-card-drag-handle]');
        handle?.setAttribute('aria-pressed', String(picked));
      });
    }

    function onKeyDown(event) {
      const handle = event.target.closest('[data-card-drag-handle]');
      if (!handle || !editingMode()) return;
      const card = handle.closest('[data-card-placement-id]');
      const placementId = card?.dataset.cardPlacementId;
      if (!placementId) return;
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        const picked = keyboardPlacementId === placementId;
        setKeyboardPicked(picked ? null : placementId);
        announce?.(picked ? '已放下卡片' : '已拿起卡片，可使用方向键移动');
        return;
      }
      if (event.key === 'Escape' && keyboardPlacementId) {
        event.preventDefault();
        // Keep the page-level Escape (exit organize mode) from also firing:
        // during a keyboard pick, Escape only puts the card down.
        event.stopPropagation?.();
        setKeyboardPicked(null);
        announce?.('已取消移动');
        return;
      }
      if (!keyboardPlacementId || keyboardPlacementId !== placementId ||
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      onKeyboardMove?.({ placementId, direction: event.key });
    }

    function onDragLeave(event) {
      if (dropCard && !dropCard.contains(event.relatedTarget)) clearDropTarget();
    }

    container.addEventListener('dragstart', onDragStart);
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDropEvent);
    container.addEventListener('dragend', clearDragging);
    container.addEventListener('keydown', onKeyDown);
    container.ownerDocument?.addEventListener?.('dragover', onDocumentDragOver);
    container.ownerDocument?.addEventListener?.('drop', onDocumentDrop);

    return Object.freeze({
      cancel() { clearDragging(); setKeyboardPicked(null); },
      destroy() {
        container.removeEventListener('dragstart', onDragStart);
        container.removeEventListener('dragover', onDragOver);
        container.removeEventListener('dragleave', onDragLeave);
        container.removeEventListener('drop', onDropEvent);
        container.removeEventListener('dragend', clearDragging);
        container.removeEventListener('keydown', onKeyDown);
        container.ownerDocument?.removeEventListener?.('dragover', onDocumentDragOver);
        container.ownerDocument?.removeEventListener?.('drop', onDocumentDrop);
      },
    });
  }

  return Object.freeze({ attach, dropPosition });
});
