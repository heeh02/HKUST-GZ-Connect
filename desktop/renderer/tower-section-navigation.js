'use strict';

(function initializeTowerSectionNavigation(globalScope) {
  function start({ document } = {}) {
    const nav = document?.querySelector('.tower-section-nav');
    const content = document?.querySelector('.content');
    if (!nav || !content) throw new TypeError('tower navigation markup is incomplete');
    nav.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tower-target]');
      const target = button && document.getElementById(button.dataset.towerTarget);
      if (!target) return;
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      target.focus({ preventScroll: true });
    });
    nav.querySelectorAll('[data-tower-target]').forEach((button) => {
      const target = document.getElementById(button.dataset.towerTarget);
      if (target) target.tabIndex = -1;
    });
    for (const eventName of ['wheel', 'touchstart']) {
      content.addEventListener(eventName, () => {
        if (content.classList.contains('tower-scroll')) content.classList.add('user-scrolling');
      }, { passive: true });
    }
  }
  const api = Object.freeze({ start });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.towerSectionNavigation = api;
})(typeof window !== 'undefined' ? window : null);
