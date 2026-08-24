'use strict';

const {
  MAX_CUSTOM_RESOURCES,
  MAX_MERGED_RESOURCES,
  normalizeLegacyCustomResource,
  validateCustomResourceDocument,
  validateRuntimeBuiltinResources,
} = require('./campus-resource-contract');
const { ROUTE_CAMPUS, ROUTE_DIRECT, routeForUrl } = require('./campus-route');
const { isIsolatedNetworkHost } = require('./host-safety');

function normalizeResource(value) {
  if (!value || typeof value !== 'object') return null;
  let route = value.route === ROUTE_DIRECT || value.route === ROUTE_CAMPUS
    ? value.route
    : routeForUrl(value.url);
  try {
    if (route === ROUTE_DIRECT && isIsolatedNetworkHost(new URL(value.url).hostname)) {
      route = ROUTE_CAMPUS;
    }
  } catch {}
  return normalizeLegacyCustomResource({
    id: String(value.id || '').trim(),
    name: String(value.name || '').trim(),
    description: String(value.description || '').trim(),
    url: String(value.url || '').trim(),
    route,
  }, route);
}

function normalizeCustomResources(input) {
  if (!Array.isArray(input)) return [];
  const seenIds = new Set();
  const seenUrls = new Set();
  return input
    .slice(0, MAX_CUSTOM_RESOURCES)
    .map((value) => normalizeResource(value))
    .filter((resource) => {
      if (!resource || seenIds.has(resource.id) || seenUrls.has(resource.url)) return false;
      seenIds.add(resource.id);
      seenUrls.add(resource.url);
      return true;
    })
    .map(({ builtin, ...resource }) => resource);
}

function projectCampusResources(builtIns, custom) {
  const reviewed = validateRuntimeBuiltinResources(builtIns);
  const local = validateCustomResourceDocument(custom);
  const resources = [...reviewed];
  const seenIds = new Set(reviewed.map(({ id }) => id));
  const seenUrls = new Set(reviewed.map(({ url }) => url));
  let conflictCount = 0;
  let hiddenCount = 0;
  for (const resource of local) {
    // Old releases intentionally kept builtin-first behavior. A previously
    // stored custom duplicate must remain removable from settings, but cannot
    // replace or crash the reviewed builtin projection.
    if (seenIds.has(resource.id) || seenUrls.has(resource.url)) {
      conflictCount += 1;
      continue;
    }
    seenIds.add(resource.id);
    seenUrls.add(resource.url);
    if (resources.length < MAX_MERGED_RESOURCES) resources.push(resource);
    else hiddenCount += 1;
  }
  return Object.freeze({
    resources: Object.freeze(resources),
    receipt: Object.freeze({
      sourceCount: reviewed.length + local.length,
      visibleCount: resources.length,
      conflictCount,
      hiddenCount,
    }),
  });
}

function mergeCampusResources(builtIns, custom) {
  return projectCampusResources(builtIns, custom).resources;
}

function resourceRoute(resource) {
  return resource?.route === ROUTE_DIRECT ? ROUTE_DIRECT : ROUTE_CAMPUS;
}

module.exports = {
  MAX_CUSTOM_RESOURCES,
  mergeCampusResources,
  normalizeCustomResources,
  normalizeResource,
  projectCampusResources,
  resourceRoute,
};
