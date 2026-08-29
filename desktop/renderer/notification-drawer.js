'use strict';

(function initializeNotificationDrawer(globalScope) {
  function start({ document, loadLogs, runAction } = {}) {
    if (!document || typeof loadLogs !== 'function' || typeof runAction !== 'function') {
      throw new TypeError('notification drawer dependencies are incomplete');
    }
    const byId = (id) => document.getElementById(id);
    const drawer = byId('notificationDrawer');
    const backdrop = byId('notificationBackdrop');
    const trigger = byId('openNotificationDrawer');
    const closeButton = byId('closeNotificationDrawer');
    let returnFocus = null;

    function close() {
      if (drawer.hidden) return;
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
      window.setTimeout(() => {
        drawer.hidden = true;
        backdrop.hidden = true;
        returnFocus?.focus?.();
      }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
    }

    function open() {
      returnFocus = document.activeElement;
      drawer.hidden = false;
      backdrop.hidden = false;
      window.requestAnimationFrame(() => {
        drawer.classList.add('open');
        backdrop.classList.add('open');
        closeButton.focus();
      });
      loadLogs();
    }

    trigger.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    byId('logRefresh').addEventListener('click', loadLogs);
    byId('notificationAction').addEventListener('click', () => {
      runAction(byId('notificationAction').dataset.action);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !drawer.hidden) {
        event.preventDefault();
        close();
      }
      if (event.key !== 'Tab' || drawer.hidden) return;
      const focusable = [...drawer.querySelectorAll('button, summary, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.disabled && !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    return Object.freeze({ close, open });
  }

  const api = Object.freeze({ start });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.notificationDrawer = api;
})(typeof window !== 'undefined' ? window : null);
