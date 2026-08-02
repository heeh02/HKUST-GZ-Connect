'use strict';

function visibleResources(resources, expanded, limit = 4) {
  const items = Array.isArray(resources) ? resources : [];
  return expanded ? items : items.slice(0, Math.max(0, limit));
}

function routeLabel(resource) {
  return resource?.route === 'direct' ? '直连' : '校园隧道';
}

const api = { routeLabel, visibleResources };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.resourceView = api;
