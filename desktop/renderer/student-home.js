(function (root, factory) {
  const resourceView = typeof module !== 'undefined' && module.exports
    ? require('../lib/resources/presentation/resource-view')
    : root.resourceView;
  const api = factory(resourceView);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.studentHome = api;
})(typeof self !== 'undefined' ? self : globalThis, function (resourceView) {
  'use strict';

  const RESOURCE_ICONS = Object.freeze({
    common: '<svg viewBox="0 0 24 24"><path d="M7 4.5h10M8 3h8v3H8zM6 5.5h12v15H6z"/><path d="M9 10h6M9 14h6M9 18h4"/></svg>',
    academic: '<svg viewBox="0 0 24 24"><path d="M4 5.5h6.5A2.5 2.5 0 0 1 13 8v11a2.5 2.5 0 0 0-2.5-2.5H4z"/><path d="M20 5.5h-4.5A2.5 2.5 0 0 0 13 8v11a2.5 2.5 0 0 1 2.5-2.5H20z"/></svg>',
    'campus-service': '<svg viewBox="0 0 24 24"><path d="m4 9 8-5 8 5M5.5 9.5h13v10h-13z"/><path d="M9 19.5v-6h6v6M3.5 20h17"/></svg>',
    custom: '<svg viewBox="0 0 24 24"><path d="M10 13.5a4 4 0 0 0 5.7.1l2.2-2.2a4 4 0 0 0-5.7-5.7L11 6.9"/><path d="M14 10.5a4 4 0 0 0-5.7-.1l-2.2 2.2a4 4 0 0 0 5.7 5.7l1.2-1.2"/></svg>',
  });

  function resourceIconKind(category) {
    return Object.hasOwn(RESOURCE_ICONS, category) ? category : 'custom';
  }

  function resourceIcon(category) {
    return RESOURCE_ICONS[resourceIconKind(category)];
  }

  function renderStudentHome({
    resources,
    query,
    view,
    expanded,
    translate,
    escapeHtml,
  } = {}) {
    if (!resourceView || typeof translate !== 'function' || typeof escapeHtml !== 'function') {
      throw new TypeError('Student Home dependencies are incomplete');
    }
    const { filteredResources, routeLabel, visibleResources } = resourceView;
    const source = Array.isArray(resources) ? resources : [];
    const filtered = filteredResources(source, { query, view });
    const focused = String(query || '').length > 0 || view !== 'all';
    const esc = escapeHtml;
    const cards = (items) => items.map((resource) => {
      const iconKind = resourceIconKind(resource.category);
      return `<div class="resource-card" data-campus-id="${esc(resource.id)}">`
      + `<button class="resource-link" type="button" data-resource-action="open" title="${esc(resource.url)}">`
      + `<span class="resource-icon resource-icon-${iconKind}" aria-hidden="true">${resourceIcon(iconKind)}</span>`
      + '<span class="resource-copy">'
      + `<span class="resource-name">${esc(resource.name)}</span>`
      + `<span class="resource-desc">${esc(resource.description || resource.url)}</span>`
      + `<span class="resource-meta"><span class="resource-route ${resource.route === 'direct' ? 'direct' : 'campus'}">${esc(routeLabel(resource, translate))}</span>`
      + `<span class="resource-origin">${esc(translate(resource.reviewed === true || resource.builtin === true
        ? 'resources.sourceReviewed' : 'resources.sourceLocal'))}</span></span></span></button>`
      + `<button class="resource-favorite${resource.favorite ? ' active' : ''}" type="button" data-resource-action="favorite"`
      + ` aria-label="${esc(resource.favorite ? translate('resources.unfavorite') : translate('resources.favorite'))}"`
      + ` title="${esc(resource.favorite ? translate('resources.unfavorite') : translate('resources.favorite'))}">${resource.favorite ? '★' : '☆'}</button></div>`;
    }).join('');
    const section = (title, items) => items.length
      ? `<section class="resource-section"><h3>${esc(title)}</h3><div class="resource-grid">${cards(items)}</div></section>`
      : '';
    let html;
    if (focused) {
      const visible = visibleResources(filtered, true);
      html = visible.length
        ? section(translate('resources.results'), visible)
        : `<div class="resource-empty">${esc(translate('resources.empty'))}</div>`;
    } else {
      if (expanded === true) {
        html = section(translate('resources.allSection'), filtered);
        return Object.freeze({ html, hasMore: filtered.length > 0 });
      }
      const shown = new Set();
      const take = (items, limit = 4) => items.filter(({ id }) => !shown.has(id)).slice(0, limit)
        .map((resource) => { shown.add(resource.id); return resource; });
      const favorites = take(source.filter(({ favorite }) => favorite === true));
      const recent = [...source]
        .filter(({ lastOpenedAt }) => Number.isSafeInteger(lastOpenedAt) && lastOpenedAt > 0)
        .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
      const uniqueRecent = take(recent);
      const recommended = take(source.filter((resource) =>
        resource.reviewed === true || resource.builtin === true));
      html = section(translate('resources.favoritesSection'), favorites)
        + section(translate('resources.recentSection'), uniqueRecent)
        + section(translate('resources.recommendedSection'), recommended);
      if (!html) html = section(translate('resources.allSection'), visibleResources(filtered, false, 8));
      if (!html) html = `<div class="resource-empty">${esc(translate('resources.empty'))}</div>`;
      return Object.freeze({ html, hasMore: filtered.some(({ id }) => !shown.has(id)) });
    }
    return Object.freeze({ html, hasMore: false });
  }

  return { renderStudentHome };
});
