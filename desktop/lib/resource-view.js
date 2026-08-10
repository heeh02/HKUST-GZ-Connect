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

  const resourceViewApi = { routeLabel, visibleResources };
  if (typeof module !== 'undefined' && module.exports) module.exports = resourceViewApi;
  if (globalScope) globalScope.resourceView = resourceViewApi;
})(typeof window !== 'undefined' ? window : null);
