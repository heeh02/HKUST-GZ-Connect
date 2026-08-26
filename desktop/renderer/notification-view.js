(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.notificationView = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function applyState(card, state = {}) {
    if (!card?.classList) return false;
    card.classList.toggle('connected', state.connected === true);
    card.classList.toggle('busy', state.connecting === true);
    card.classList.toggle('error', state.connected !== true
      && state.connecting !== true
      && typeof state.lastError === 'string'
      && state.lastError.length > 0);
    return true;
  }

  const CATEGORIES = new Set([
    'idle', 'ready', 'connecting', 'authentication', 'configuration', 'local-listener',
    'local-state', 'network', 'browser', 'dns', 'error',
  ]);
  const ACTIONS = new Set(['none', 'reconnect', 'open-settings', 'open-tower']);

  function publicRecovery(state) {
    const category = CATEGORIES.has(state?.recovery?.category)
      ? state.recovery.category : state?.lastError ? 'error' : 'idle';
    const action = ACTIONS.has(state?.recovery?.action) ? state.recovery.action
      : category === 'error' ? 'reconnect' : 'none';
    return Object.freeze({ category, action });
  }

  function render({ card, title, summary, action, state = {}, translate } = {}) {
    if (![card, title, summary, action].every(Boolean) || typeof translate !== 'function') {
      throw new TypeError('notification view dependencies are incomplete');
    }
    const recovery = publicRecovery(state);
    applyState(card, state);
    title.textContent = translate(`notif.status.${recovery.category}`);
    summary.textContent = state.lastError || translate(`notif.summary.${recovery.category}`);
    action.hidden = recovery.action === 'none';
    action.dataset.action = recovery.action;
    if (!action.hidden) action.textContent = translate(`notif.action.${recovery.action}`);
    return recovery;
  }

  async function runAction(action, { openPage, reconnect } = {}) {
    if (typeof openPage !== 'function' || typeof reconnect !== 'function') return false;
    if (action === 'open-settings') { openPage('settings'); return true; }
    if (action === 'open-tower') { openPage('tower'); return true; }
    if (action === 'reconnect') { openPage('connect'); await reconnect(); return true; }
    return false;
  }

  return { applyState, publicRecovery, render, runAction };
});
