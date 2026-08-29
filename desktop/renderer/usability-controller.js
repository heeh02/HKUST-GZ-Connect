'use strict';

(function initializeUsabilityController(globalScope) {
  const PAGE_SHORTCUTS = Object.freeze({ 1: 'connect', 2: 'browser', 3: 'tower', 4: 'settings' });

  function create({ window, document, translate, openPage, clearResourceFilter, openResourceManager,
    openCampusWorkspace }) {
    if (!window || !document || typeof translate !== 'function' || typeof openPage !== 'function' ||
        typeof clearResourceFilter !== 'function' || typeof openResourceManager !== 'function' ||
        typeof openCampusWorkspace !== 'function') {
      throw new TypeError('Usability controller dependencies are incomplete');
    }
    let toastTimer = null;

    function toast(message, tone = 'success') {
      const element = document.getElementById('globalToast');
      window.clearTimeout(toastTimer);
      element.textContent = String(message || '');
      element.dataset.tone = ['success', 'error', 'info'].includes(tone) ? tone : 'info';
      element.hidden = !element.textContent;
      if (!element.hidden) toastTimer = window.setTimeout(() => { element.hidden = true; }, 1800);
    }

    function updateConnection(state = {}) {
      const nav = document.querySelector('.nav[data-page="connect"]');
      const indicator = document.getElementById('navConnectionState');
      const mode = state.connected ? 'connected'
        : state.connecting ? 'busy'
          : state.lastError ? 'error' : 'disconnected';
      indicator.className = `nav-connection-state ${mode}`;
      const status = translate(mode === 'connected' ? 'connect.connected'
        : mode === 'busy' ? 'connect.connecting'
          : mode === 'error' ? 'feedback.connectionNeedsAttention' : 'connect.disconnected');
      const shortcut = /Mac|iPhone|iPad/u.test(window.navigator?.platform || '') ? '⌘1' : 'Ctrl+1';
      const label = `${translate('nav.connect')} · ${status} (${shortcut})`;
      nav.title = label;
      nav.setAttribute('aria-label', label);
    }

    function focusResourceSearch() {
      if (document.getElementById('dash').hidden) return;
      openPage('browser');
      document.getElementById('resourceSearch').focus();
    }

    function start() {
      document.getElementById('openCampusWorkspace').addEventListener('click', () => {
        Promise.resolve(openCampusWorkspace()).then((result) => {
          if (!result?.ok) toast(result?.error || translate('quick.browserOpenFailed'), 'error');
        }).catch(() => toast(translate('quick.browserOpenFailed'), 'error'));
      });
      document.addEventListener('keydown', (event) => {
        const command = event.metaKey || event.ctrlKey;
        if (command && PAGE_SHORTCUTS[event.key] && !event.altKey) {
          event.preventDefault();
          if (!document.getElementById('dash').hidden) openPage(PAGE_SHORTCUTS[event.key]);
        } else if (command && event.key.toLowerCase() === 'k' && !event.altKey) {
          event.preventDefault();
          focusResourceSearch();
        } else if (event.key === 'Escape' && !document.getElementById('dash').hidden) {
          clearResourceFilter();
        }
      });
      document.addEventListener('click', (event) => {
        const action = event.target.closest('[data-resource-empty-action]')?.dataset.resourceEmptyAction;
        if (action === 'clear') clearResourceFilter();
        else if (action === 'manage') openResourceManager();
      });
    }

    return Object.freeze({ start, toast, updateConnection });
  }

  const api = Object.freeze({ create });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.usabilityController = api;
})(typeof window !== 'undefined' ? window : null);
