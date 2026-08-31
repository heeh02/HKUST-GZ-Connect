(function initializeCardBoardMotion(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.cardBoardMotion = api;
})(typeof self !== 'undefined' ? self : globalThis, function cardBoardMotionFactory() {
  'use strict';

  function availableHeight(container, bottomMargin = 28) {
    const ownerWindow = container?.ownerDocument?.defaultView;
    const top = container?.getBoundingClientRect?.().top || 0;
    return ownerWindow ? Math.max(0, ownerWindow.innerHeight - top - bottomMargin) : 0;
  }

  function placementRects(container) {
    return new Map([...container.querySelectorAll('[data-card-placement-id]')].map((card) => [
      card.dataset.cardPlacementId,
      card.getBoundingClientRect(),
    ]));
  }

  function scrollPlacementIntoView(container, placementId) {
    const card = [...container.querySelectorAll('[data-card-placement-id]')]
      .find((candidate) => candidate.dataset.cardPlacementId === placementId);
    if (!card || typeof card.scrollIntoView !== 'function') return false;
    const reduced = container.ownerDocument?.defaultView
      ?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    card.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    return true;
  }

  function animateFrom(container, previousRects) {
    const ownerWindow = container?.ownerDocument?.defaultView;
    if (!previousRects?.size || !ownerWindow ||
        ownerWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    ownerWindow.requestAnimationFrame(() => {
      for (const card of container.querySelectorAll('[data-card-placement-id]')) {
        const previous = previousRects.get(card.dataset.cardPlacementId);
        if (!previous || typeof card.animate !== 'function') continue;
        const current = card.getBoundingClientRect();
        const dx = previous.left - current.left;
        const dy = previous.top - current.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        card.animate([
          { transform: `translate(${dx}px, ${dy}px)`, opacity: .82 },
          { transform: 'translate(0, 0)', opacity: 1 },
        ], { duration: 250, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    });
    return true;
  }

  function observeResponsive({ container, model, current, onChange, delay = 120 } = {}) {
    if (!container || typeof model?.columnsForWidth !== 'function' ||
        typeof model?.layoutCapacity !== 'function' || typeof current !== 'function' ||
        typeof onChange !== 'function') {
      throw new TypeError('card board responsive motion dependencies are incomplete');
    }
    const ownerWindow = container.ownerDocument?.defaultView;
    let frame = null;
    let timer = null;
    const schedule = (width = container.clientWidth) => {
      ownerWindow?.cancelAnimationFrame?.(frame);
      clearTimeout(timer);
      frame = ownerWindow?.requestAnimationFrame?.(() => {
        const state = current();
        const columns = model.columnsForWidth(width || container.clientWidth);
        const height = availableHeight(container);
        const oldRows = model.layoutCapacity(state.columns, state.availableHeight).rows;
        const rows = model.layoutCapacity(columns, height).rows;
        if (columns !== state.columns) {
          onChange({ columns, availableHeight: height, animate: false });
          return;
        }
        if (rows === oldRows) {
          onChange({ columns, availableHeight: height, measureOnly: true });
          return;
        }
        timer = setTimeout(() => onChange({
          columns, availableHeight: height, animate: true,
        }), delay);
      }) ?? null;
    };
    const ResizeObserverClass = ownerWindow?.ResizeObserver || globalThis.ResizeObserver;
    const observer = typeof ResizeObserverClass === 'function'
      ? new ResizeObserverClass((entries) => schedule(
        entries[0]?.contentRect?.width || container.clientWidth,
      )) : null;
    observer?.observe(container);
    ownerWindow?.addEventListener?.('resize', schedule);
    return Object.freeze({
      schedule,
      destroy() {
        ownerWindow?.cancelAnimationFrame?.(frame);
        clearTimeout(timer);
        observer?.disconnect();
        ownerWindow?.removeEventListener?.('resize', schedule);
      },
    });
  }

  return Object.freeze({
    animateFrom,
    availableHeight,
    observeResponsive,
    placementRects,
    scrollPlacementIntoView,
  });
});
