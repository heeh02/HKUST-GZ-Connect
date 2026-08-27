(function (root, factory) {
  const resourceView = typeof module !== 'undefined' && module.exports
    ? require('../lib/resources/presentation/resource-view')
    : root.resourceView;
  const resourceLayoutPolicy = typeof module !== 'undefined' && module.exports
    ? require('./resource-layout-policy')
    : root.resourceLayoutPolicy;
  const api = factory(resourceView, resourceLayoutPolicy);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.studentHome = api;
})(typeof self !== 'undefined' ? self : globalThis, function (resourceView, resourceLayoutPolicy) {
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
    layout,
    translate,
    escapeHtml,
  } = {}) {
    if (!resourceView || !resourceLayoutPolicy || typeof translate !== 'function' ||
        typeof escapeHtml !== 'function') {
      throw new TypeError('Student Home dependencies are incomplete');
    }
    const { filteredResources, routeLabel, visibleResources } = resourceView;
    const normalizedLayout = resourceLayoutPolicy.normalizeLayout(layout);
    const source = Array.isArray(resources) ? resources : [];
    const filtered = filteredResources(source, { query, view });
    const focused = String(query || '').length > 0 || view !== 'all';
    const esc = escapeHtml;
    const cards = (items) => items.map((resource) => {
      const iconKind = resourceIconKind(resource.category);
      const direct = resource.route === 'direct';
      const fullRoute = routeLabel(resource, translate);
      const shortRoute = translate(direct
        ? 'resources.routeDirectShort' : 'resources.routeCampusShort');
      const tooltip = [resource.name, resource.description, resource.url, fullRoute]
        .filter((value) => typeof value === 'string' && value.trim()).join('\n');
      return `<div class="resource-card" data-campus-id="${esc(resource.id)}">`
      + `<button class="resource-link" type="button" data-resource-action="open" title="${esc(tooltip)}"`
      + ` aria-label="${esc(`${resource.name}, ${fullRoute}`)}">`
      + `<span class="resource-icon resource-icon-${iconKind}" aria-hidden="true">${resourceIcon(iconKind)}`
      + `<span class="resource-route-short ${direct ? 'direct' : 'campus'}">${esc(shortRoute)}</span></span>`
      + '<span class="resource-copy">'
      + `<span class="resource-name">${esc(resource.name)}</span>`
      + '</span></button>'
      + `<button class="resource-favorite${resource.favorite ? ' active' : ''}" type="button" data-resource-action="favorite"`
      + ` aria-label="${esc(resource.favorite ? translate('resources.unfavorite') : translate('resources.favorite'))}"`
      + ` title="${esc(resource.favorite ? translate('resources.unfavorite') : translate('resources.favorite'))}">${resource.favorite ? '★' : '☆'}</button></div>`;
    }).join('');
    const section = (kind, title, items) => items.length
      ? `<section class="resource-section resource-section-${kind}"><h3>${esc(title)}</h3><div class="resource-grid">${cards(items)}</div></section>`
      : '';
    const emptyState = (clearable) => '<div class="resource-empty">'
      + `<strong>${esc(translate('resources.empty'))}</strong>`
      + `<span>${esc(translate(clearable ? 'resources.emptyFilteredHint' : 'resources.emptyHint'))}</span>`
      + '<div class="resource-empty-actions">'
      + (clearable ? `<button class="mini" type="button" data-resource-empty-action="clear">${esc(translate('resources.clearFilter'))}</button>` : '')
      + `<button class="mini" type="button" data-resource-empty-action="manage">${esc(translate('resources.manage'))}</button>`
      + '</div></div>';
    let html;
    if (focused) {
      const visible = visibleResources(filtered, true);
      html = visible.length
        ? section('results', translate('resources.results'), visible)
        : emptyState(true);
    } else {
      if (expanded === true) {
        html = section('all', translate('resources.allSection'), filtered);
        return Object.freeze({ html, hasMore: filtered.length > 0 });
      }
      const shown = new Set();
      const take = (items, limit = normalizedLayout.sectionLimit) =>
        items.filter(({ id }) => !shown.has(id)).slice(0, limit)
        .map((resource) => { shown.add(resource.id); return resource; });
      const favorites = take(source.filter(({ favorite }) => favorite === true));
      const recent = [...source]
        .filter(({ lastOpenedAt }) => Number.isSafeInteger(lastOpenedAt) && lastOpenedAt > 0)
        .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
      const uniqueRecent = take(recent);
      const recommended = take(source.filter((resource) =>
        resource.reviewed === true || resource.builtin === true));
      html = section('favorites', translate('resources.favoritesSection'), favorites)
        + section('recent', translate('resources.recentSection'), uniqueRecent)
        + section('recommended', translate('resources.recommendedSection'), recommended);
      if (!html) html = section('all', translate('resources.allSection'),
        visibleResources(filtered, false, normalizedLayout.sectionLimit));
      if (!html) html = emptyState(false);
      return Object.freeze({ html, hasMore: filtered.length > 0 });
    }
    return Object.freeze({ html, hasMore: false });
  }

  return { renderStudentHome };
});
