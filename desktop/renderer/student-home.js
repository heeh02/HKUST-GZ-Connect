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
    'getting-started': '<svg viewBox="0 0 24 24"><path d="m4 9 8-5 8 5M6 10v9h12v-9M9 19v-5h6v5"/></svg>',
    learning: '<svg viewBox="0 0 24 24"><path d="M4 5.5h6.5A2.5 2.5 0 0 1 13 8v11a2.5 2.5 0 0 0-2.5-2.5H4zM20 5.5h-4.5A2.5 2.5 0 0 0 13 8v11a2.5 2.5 0 0 1 2.5-2.5H20z"/></svg>',
    research: '<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3M8 15h8"/></svg>',
    finance: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h3M14 12h2M8 16h3M14 16h2"/></svg>',
    career: '<svg viewBox="0 0 24 24"><path d="M4 8h16v11H4zM9 8V5h6v3M4 12h16M10 12v2h4v-2"/></svg>',
    'campus-life': '<svg viewBox="0 0 24 24"><path d="m4 9 8-5 8 5M5.5 9.5h13v10h-13zM9 19.5v-6h6v6M3.5 20h17"/></svg>',
    applications: '<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6zM14 3v4h4M9 11h6M9 15h6M9 19h4"/></svg>',
    services: '<svg viewBox="0 0 24 24"><path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z"/></svg>',
    common: '<svg viewBox="0 0 24 24"><path d="M7 4.5h10M8 3h8v3H8zM6 5.5h12v15H6z"/><path d="M9 10h6M9 14h6M9 18h4"/></svg>',
    academic: '<svg viewBox="0 0 24 24"><path d="M4 5.5h6.5A2.5 2.5 0 0 1 13 8v11a2.5 2.5 0 0 0-2.5-2.5H4z"/><path d="M20 5.5h-4.5A2.5 2.5 0 0 0 13 8v11a2.5 2.5 0 0 1 2.5-2.5H20z"/></svg>',
    'campus-service': '<svg viewBox="0 0 24 24"><path d="m4 9 8-5 8 5M5.5 9.5h13v10h-13z"/><path d="M9 19.5v-6h6v6M3.5 20h17"/></svg>',
    custom: '<svg viewBox="0 0 24 24"><path d="M10 13.5a4 4 0 0 0 5.7.1l2.2-2.2a4 4 0 0 0-5.7-5.7L11 6.9"/><path d="M14 10.5a4 4 0 0 0-5.7-.1l-2.2 2.2a4 4 0 0 0 5.7 5.7l1.2-1.2"/></svg>',
  });

  function resourceIconKind(category) {
    const aliases = {
      gateway: 'services', newcomer: 'getting-started', courses: 'learning', labs: 'research',
      'student-finance': 'finance', expenses: 'finance', documents: 'applications',
      tools: 'services', staff: 'services', common: 'services', academic: 'learning',
      'campus-service': 'campus-life',
    };
    const normalized = aliases[category] || category;
    return Object.hasOwn(RESOURCE_ICONS, normalized) ? normalized : 'custom';
  }

  function resourceIcon(category) {
    return RESOURCE_ICONS[resourceIconKind(category)];
  }

  function renderStudentHome({
    resources,
    groups,
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
      const favorites = source.filter(({ favorite }) => favorite === true);
      const byId = new Map(favorites.map((resource) => [resource.id, resource]));
      const assigned = new Set();
      const safeGroups = Array.isArray(groups) && groups.length <= 16 ? groups : [];
      html = safeGroups.map((group) => {
        const name = typeof group?.name === 'string' && group.name.trim() &&
          group.name.length <= 30 && !/[\u0000-\u001f\u007f<>]/u.test(group.name)
          ? group.name.trim() : '';
        const ids = Array.isArray(group?.resourceIds) ? group.resourceIds : [];
        if (!name || ids.length > 64) return '';
        const items = ids.map((id) => byId.get(id)).filter((resource) => {
          if (!resource || assigned.has(resource.id)) return false;
          assigned.add(resource.id); return true;
        });
        return section('bookmark-folder', name, items);
      }).join('');
      const ungrouped = favorites.filter(({ id }) => !assigned.has(id));
      html = section('favorites', translate('resources.favoritesSection'), ungrouped) + html;
      if (!html) html = emptyState(false);
      return Object.freeze({ html, hasMore: false });
    }
    return Object.freeze({ html, hasMore: false });
  }

  return { renderStudentHome };
});
