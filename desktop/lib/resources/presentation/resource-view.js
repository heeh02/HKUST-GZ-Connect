'use strict';

(function initializeResourceView(globalScope) {
  function visibleResources(resources, expanded, limit = 4) {
    const items = Array.isArray(resources) ? resources : [];
    return expanded ? items : items.slice(0, Math.max(0, limit));
  }

  function routeLabel(resource, translate = null) {
    const direct = resource?.route === 'direct';
    const fallback = direct ? '直连' : '校园隧道';
    if (typeof translate !== 'function') return fallback;
    const translated = translate(direct ? 'resources.routeDirect' : 'resources.routeCampus');
    return typeof translated === 'string' && translated ? translated : fallback;
  }

  function filteredResources(resources, { query = '', view = 'all' } = {}) {
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
    const supportedViews = new Set([
      'all', 'favorites', 'recent', 'common', 'academic', 'campus-service', 'custom',
    ]);
    const selectedView = supportedViews.has(view) ? view : 'all';
    let items = Array.isArray(resources) ? [...resources] : [];
    if (selectedView === 'favorites') items = items.filter(({ favorite }) => favorite === true);
    else if (selectedView === 'recent') {
      items = items
        .filter(({ lastOpenedAt }) => Number.isSafeInteger(lastOpenedAt) && lastOpenedAt > 0)
        .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
    } else if (selectedView !== 'all') {
      items = items.filter(({ category }) => category === selectedView);
    }
    if (!normalizedQuery) return items;
    return items.filter((resource) => [
      resource.name,
      resource.description,
      resource.url,
      ...(Array.isArray(resource.keywords) ? resource.keywords : []),
    ].some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery)));
  }

  const resourceViewApi = { filteredResources, routeLabel, visibleResources };
  if (typeof module !== 'undefined' && module.exports) module.exports = resourceViewApi;
  if (globalScope) globalScope.resourceView = resourceViewApi;
})(typeof window !== 'undefined' ? window : null);
