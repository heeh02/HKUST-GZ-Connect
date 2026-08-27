(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.campusWorkspaceModel = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TASK_CATEGORIES = Object.freeze([
    Object.freeze({ id: 'newcomer', labelKey: 'newcomer' }),
    Object.freeze({ id: 'courses', labelKey: 'courses' }),
    Object.freeze({ id: 'research', labelKey: 'research' }),
    Object.freeze({ id: 'labs', labelKey: 'labs' }),
    Object.freeze({ id: 'student-finance', labelKey: 'studentFinance' }),
    Object.freeze({ id: 'expenses', labelKey: 'expenses' }),
    Object.freeze({ id: 'career', labelKey: 'career' }),
    Object.freeze({ id: 'campus-life', labelKey: 'campusLife' }),
    Object.freeze({ id: 'documents', labelKey: 'documents' }),
    Object.freeze({ id: 'tools', labelKey: 'tools' }),
    Object.freeze({ id: 'staff', labelKey: 'staff' }),
    Object.freeze({ id: 'custom', labelKey: 'custom' }),
  ]);
  const CATEGORY_ALIASES = Object.freeze({
    'getting-started': 'newcomer',
    learning: 'courses',
    academic: 'courses',
    finance: 'student-finance',
    applications: 'documents',
    services: 'tools',
    common: 'tools',
    'campus-service': 'campus-life',
  });
  const SCREENS = new Set(['home', 'manage']);
  const STARTER_IDS = Object.freeze(['sis', 'canvas', 'library', 'outlook']);

  function categoryOf(resource) {
    const category = CATEGORY_ALIASES[resource?.category] || resource?.category;
    return TASK_CATEGORIES.some(({ id }) => id === category) ? category : 'custom';
  }

  function normalizeNavigation(value = {}) {
    const screen = SCREENS.has(value.screen) ? value.screen : 'home';
    const query = String(value.query || '').trim().slice(0, 80).toLocaleLowerCase();
    return Object.freeze({ screen, query });
  }

  function searchResources(resources, query) {
    const normalized = String(query || '').trim().toLocaleLowerCase();
    if (!normalized) return Object.freeze([]);
    return Object.freeze((Array.isArray(resources) ? resources : []).filter((resource) => [
      resource.name,
      resource.category,
      categoryOf(resource),
      ...(Array.isArray(resource.keywords) ? resource.keywords : []),
    ].some((value) => String(value || '').toLocaleLowerCase().includes(normalized))));
  }

  function homeProjection(resources) {
    const source = Array.isArray(resources) ? resources : [];
    const gateways = source.filter(({ category }) => category === 'gateway');
    const favorites = source.filter(({ favorite, category }) => favorite && category !== 'gateway');
    const favoriteIds = new Set(favorites.map(({ id }) => id));
    const recent = source.filter(({ id, category, lastOpenedAt }) =>
      category !== 'gateway' && !favoriteIds.has(id) && Number.isSafeInteger(lastOpenedAt))
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      .slice(0, 8);
    const starter = favorites.length >= 3 ? [] : STARTER_IDS
      .map((id) => source.find((resource) => resource.id === id))
      .filter((resource) => resource && !favoriteIds.has(resource.id));
    return Object.freeze({
      gateways: Object.freeze(gateways),
      favorites: Object.freeze(favorites),
      recent: Object.freeze(recent),
      starter: Object.freeze(starter),
    });
  }

  function catalogProjection(resources, category = null) {
    const source = (Array.isArray(resources) ? resources : [])
      .filter((resource) => resource.category !== 'gateway');
    const categories = TASK_CATEGORIES.map((entry) => Object.freeze({
      ...entry,
      count: source.filter((resource) => categoryOf(resource) === entry.id).length,
    })).filter(({ count }) => count > 0);
    const items = category
      ? source.filter((resource) => categoryOf(resource) === category)
      : [];
    return Object.freeze({
      categories: Object.freeze(categories),
      items: Object.freeze(items),
    });
  }

  return Object.freeze({
    TASK_CATEGORIES,
    catalogProjection,
    categoryOf,
    homeProjection,
    normalizeNavigation,
    searchResources,
  });
});
