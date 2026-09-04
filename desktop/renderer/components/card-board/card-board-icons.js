(function initializeCardBoardIcons(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.cardBoardIcons = api;
})(typeof self !== 'undefined' ? self : globalThis, function cardBoardIconsFactory() {
  'use strict';

  const CATEGORY_PATHS = Object.freeze({
    gateway: '<circle cx="12" cy="12" r="8"/><path d="m15 9-2 4-4 2 2-4z"/>',
    courses: '<path d="M4 6h6.5A2.5 2.5 0 0 1 13 8.5V19a2.5 2.5 0 0 0-2.5-2.5H4zM20 6h-4.5A2.5 2.5 0 0 0 13 8.5V19a2.5 2.5 0 0 1 2.5-2.5H20z"/>',
    research: '<path d="M9 3h6M10 3v5l-4.5 8A3 3 0 0 0 8 20h8a3 3 0 0 0 2.5-4L14 8V3M8 15h8"/>',
    labs: '<path d="M9 3h6M12 3v5m-4 4 4-4 4 4M6 21h12M8 21v-4a4 4 0 0 1 8 0v4"/>',
    'student-finance': '<path d="M4 7h14a2 2 0 0 1 2 2v9H6a2 2 0 0 1-2-2zM4 7l11-3v3M15 12h5"/>',
    expenses: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3"/>',
    documents: '<path d="M6 3h8l4 4v14H6zM14 3v5h5M9 14l2 2 4-4"/>',
    'campus-life': '<path d="m3 11 9-7 9 7M5 10v10h14V10M9 20v-6h6v6"/>',
    career: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2"/>',
    tools: '<path d="M4 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-5a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h5z"/><path d="m16 9 2 2-2 2"/>',
    newcomer: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M18 8v6M15 11h6"/>',
    staff: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6.5 16a3 3 0 0 1 5 0M14 10h3M14 14h3"/>',
    custom: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  });

  function svg(name, paths) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" data-category-icon="${name}">${paths}</svg>`;
  }

  function categoryIcon(kind, id) {
    if (kind === 'user-collection') {
      // A stack of cards, not a folder: personal categories are decks.
      return svg('collection', '<rect x="6" y="8" width="12" height="12" rx="2"/><path d="M3.5 11v7a2 2 0 0 0 2 2h11"/><path d="M9.5 4h9a2 2 0 0 1 2 2v8.5"/>');
    }
    if (kind === 'system-widget') {
      return svg('widget', '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8M12 8v8"/>');
    }
    const name = Object.hasOwn(CATEGORY_PATHS, id) ? id : 'custom';
    return svg(name, CATEGORY_PATHS[name]);
  }

  function siteIcon(resource) {
    const category = String(resource?.category || 'custom');
    const paths = category === 'learning' || category === 'courses'
      ? CATEGORY_PATHS.courses
      : CATEGORY_PATHS.custom;
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  }

  return Object.freeze({ categoryIcon, siteIcon });
});
