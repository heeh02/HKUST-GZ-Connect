(function (root, factory) {
  const resourceView = typeof module !== 'undefined' && module.exports
    ? require('../lib/resources/presentation/resource-view')
    : root.resourceView;
  const api = factory(resourceView);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.studentHome = api;
})(typeof self !== 'undefined' ? self : globalThis, function (resourceView) {
  'use strict';

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
    const cards = (items) => items.map((resource) =>
      `<div class="resource-card" data-campus-id="${esc(resource.id)}">`
      + `<button class="resource-link" type="button" data-resource-action="open" title="${esc(resource.url)}">`
      + `<span class="resource-name">${esc(resource.name)}</span>`
      + `<span class="resource-desc">${esc(resource.description || resource.url)}</span>`
      + `<span class="resource-meta"><span class="resource-route ${resource.route === 'direct' ? 'direct' : 'campus'}">${esc(routeLabel(resource, translate))}</span>`
      + `<span class="resource-origin">${esc(translate(resource.reviewed === true || resource.builtin === true
        ? 'resources.sourceReviewed' : 'resources.sourceLocal'))}</span></span></button>`
      + `<button class="resource-favorite${resource.favorite ? ' active' : ''}" type="button" data-resource-action="favorite"`
      + ` aria-label="${esc(resource.favorite ? translate('resources.unfavorite') : translate('resources.favorite'))}"`
      + ` title="${esc(resource.favorite ? translate('resources.unfavorite') : translate('resources.favorite'))}">★</button></div>`).join('');
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
