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
