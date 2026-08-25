'use strict';

const {
  MAX_CUSTOM_RESOURCES,
  MAX_MERGED_RESOURCES,
  normalizeCustomResources,
  normalizeResource,
  validateCustomResourceDocument,
  validateRuntimeBuiltinResources,
} = require('../schema/campus-resource-contract');
const { ROUTE_CAMPUS, ROUTE_DIRECT } = require('../../routing/policy/campus-route');

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

function projectWebResourceLibrary(builtIns, custom) {
  const reviewed = validateRuntimeBuiltinResources(builtIns);
  const local = validateCustomResourceDocument(custom);
  const resources = [...reviewed];
  const seenIds = new Set(reviewed.map(({ id }) => id));
  const seenUrls = new Set(reviewed.map(({ url }) => url));
  let conflictCount = 0;
  for (const resource of local) {
    if (seenIds.has(resource.id) || seenUrls.has(resource.url)) {
      conflictCount += 1;
      continue;
    }
    seenIds.add(resource.id);
    seenUrls.add(resource.url);
    resources.push(resource);
  }
  return Object.freeze({
    resources: Object.freeze(resources),
    receipt: Object.freeze({
      sourceCount: reviewed.length + local.length,
      visibleCount: resources.length,
      conflictCount,
      hiddenCount: 0,
    }),
  });
}

function mergeWebResourceLibrary(builtIns, custom) {
  return projectWebResourceLibrary(builtIns, custom).resources;
}

function resourceRoute(resource) {
  return resource?.route === ROUTE_DIRECT ? ROUTE_DIRECT : ROUTE_CAMPUS;
}

function resolveResourceById(resources, resourceId) {
  if (typeof resourceId !== 'string' || !resourceId || resourceId.length > 40 ||
      !/^[a-z0-9-]+$/u.test(resourceId)) {
    throw new TypeError('resource ID is invalid');
  }
  const matches = (Array.isArray(resources) ? resources : [])
    .filter((resource) => resource?.id === resourceId);
  if (matches.length !== 1) throw new Error('resource is unavailable');
  const resource = matches[0];
  return Object.freeze({
    id: resource.id,
    url: resource.url,
    route: resourceRoute(resource),
  });
}

module.exports = {
  MAX_CUSTOM_RESOURCES,
  mergeCampusResources,
  mergeWebResourceLibrary,
  normalizeCustomResources,
  normalizeResource,
  projectCampusResources,
  projectWebResourceLibrary,
  resourceRoute,
  resolveResourceById,
};
