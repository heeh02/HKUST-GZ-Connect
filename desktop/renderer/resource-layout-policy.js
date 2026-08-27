'use strict';

(function initializeResourceLayoutPolicy(globalScope) {
  const LAYOUTS = Object.freeze({
    compact: Object.freeze({ mode: 'compact', columns: 2, sectionLimit: 4 }),
    standard: Object.freeze({ mode: 'standard', columns: 3, sectionLimit: 6 }),
    wide: Object.freeze({ mode: 'wide', columns: 4, sectionLimit: 8 }),
  });

  function layoutForWidth(value) {
    const width = Number(value);
    if (!Number.isFinite(width) || width < 460) return LAYOUTS.compact;
    if (width < 720) return LAYOUTS.standard;
    return LAYOUTS.wide;
  }

  function normalizeLayout(value) {
    const mode = value && typeof value === 'object' ? value.mode : null;
    return mode === 'standard' || mode === 'wide' ? LAYOUTS[mode] : LAYOUTS.compact;
  }

  const api = Object.freeze({ layoutForWidth, normalizeLayout });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.resourceLayoutPolicy = api;
})(typeof window !== 'undefined' ? window : null);
