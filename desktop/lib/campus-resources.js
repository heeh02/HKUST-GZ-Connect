'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeCampusUrl } = require('./campus-browser');
const { ROUTE_CAMPUS, ROUTE_DIRECT, routeForUrl } = require('./campus-route');
const { isIsolatedNetworkHost } = require('./host-safety');

const RESOURCE_FILE = path.join(__dirname, '..', 'assets', 'campus-resources.json');
const MAX_RESOURCES = 32;

function normalizeResource(value, { builtin = false } = {}) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const name = String(value.name || '').trim();
  const description = String(value.description || '').trim();
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !name || name.length > 40 || description.length > 80) {
    return null;
  }
  try {
    let route = value.route === ROUTE_DIRECT || value.route === ROUTE_CAMPUS
      ? value.route
      : routeForUrl(value.url);
    const url = normalizeCampusUrl(value.url);
    if (route === ROUTE_DIRECT && isIsolatedNetworkHost(new URL(url).hostname)) {
      route = ROUTE_CAMPUS;
    }
    return {
      id,
      name,
      description,
      url,
      route,
      builtin,
    };
  } catch {
    return null;
  }
}

function normalizeCustomResources(input) {
  if (!Array.isArray(input)) return [];
  const seenIds = new Set();
  const seenUrls = new Set();
  return input
    .slice(0, MAX_RESOURCES)
    .map((value) => normalizeResource(value))
    .filter((resource) => {
      if (!resource || seenIds.has(resource.id) || seenUrls.has(resource.url)) return false;
      seenIds.add(resource.id);
      seenUrls.add(resource.url);
      return true;
    })
    .map(({ builtin, ...resource }) => resource);
}

function mergeCampusResources(builtIns, custom) {
  const result = [];
  const seenIds = new Set();
  const seenUrls = new Set();
  for (const [items, builtin] of [[builtIns, true], [custom, false]]) {
    for (const value of Array.isArray(items) ? items : []) {
      const resource = normalizeResource(value, { builtin });
      if (!resource || seenIds.has(resource.id) || seenUrls.has(resource.url)) continue;
      seenIds.add(resource.id);
      seenUrls.add(resource.url);
      result.push(resource);
      if (result.length >= MAX_RESOURCES) return result;
    }
  }
  return result;
}

function resourceRoute(resource) {
  return resource?.route === ROUTE_DIRECT ? ROUTE_DIRECT : ROUTE_CAMPUS;
}

function loadCampusResources(file = RESOURCE_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed
      .slice(0, MAX_RESOURCES)
      .map((resource) => normalizeResource(resource, { builtin: true }))
      .filter((resource) => {
        if (!resource || seen.has(resource.id)) return false;
        seen.add(resource.id);
        return true;
      });
  } catch {
    return [];
  }
}

module.exports = {
  MAX_RESOURCES,
  RESOURCE_FILE,
  loadCampusResources,
  mergeCampusResources,
  normalizeCustomResources,
  normalizeResource,
  resourceRoute,
};
