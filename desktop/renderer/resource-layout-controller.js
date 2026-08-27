'use strict';

(function initializeResourceLayoutController(globalScope) {
  const RESOURCE_VIEWS = new Set([
    'all', 'favorites', 'recent', 'common', 'academic', 'campus-service', 'custom',
  ]);

  function create({ window, document, policy, onChange }) {
    if (!window || !document || !policy || typeof policy.layoutForWidth !== 'function' ||
        typeof onChange !== 'function') {
      throw new TypeError('Resource layout controller dependencies are incomplete');
    }
    let view = 'all';
    let layout = policy.layoutForWidth(0);
    let observer = null;
    let frame = null;

    function snapshot() {
      return Object.freeze({ view, layout });
    }

    function syncControls() {
      document.getElementById('resourceView').value = view;
      document.querySelectorAll('[data-resource-view]').forEach((button) => {
        const active = button.dataset.resourceView === view;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }

    function select(nextView) {
      const normalized = RESOURCE_VIEWS.has(nextView) ? nextView : 'all';
      if (normalized === view) {
        syncControls();
        return;
      }
      view = normalized;
      onChange();
    }

    function updateWidth(width) {
      const next = policy.layoutForWidth(width);
      if (next.mode === layout.mode) return;
      layout = next;
      onChange();
    }

    function scheduleWidth(width) {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateWidth(width);
      });
    }

    function start() {
      const shelf = document.getElementById('resourceShelf');
      const selectControl = document.getElementById('resourceView');
      const chipControls = document.getElementById('resourceViewChips');
      selectControl.addEventListener('change', (event) => select(event.target.value));
      chipControls.addEventListener('click', (event) => {
        const button = event.target.closest('[data-resource-view]');
        if (button) select(button.dataset.resourceView);
      });
      scheduleWidth(shelf.getBoundingClientRect().width);
      if (typeof window.ResizeObserver !== 'function') {
        window.addEventListener('resize', () => scheduleWidth(shelf.getBoundingClientRect().width));
        return;
      }
      observer = new window.ResizeObserver((entries) => {
        const width = entries.find((entry) => entry.target === shelf)?.contentRect?.width;
        if (Number.isFinite(width)) scheduleWidth(width);
      });
      observer.observe(shelf);
    }

    return Object.freeze({ start, snapshot, syncControls });
  }

  const api = Object.freeze({ create });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.resourceLayoutController = api;
})(typeof window !== 'undefined' ? window : null);
