'use strict';

const { ROUTE_CAMPUS, ROUTE_DIRECT, routeForUrl } = require('./campus-route');
const { normalizeCampusUrl } = require('./campus-browser');

function normalizeOpenRequest(input, t) {
  const source = input && typeof input === 'object' ? input : { url: input };
  const url = normalizeCampusUrl(source.url, undefined, t);
  const route = [ROUTE_CAMPUS, ROUTE_DIRECT].includes(source.route)
    ? source.route
    : routeForUrl(url);
  return { url, route };
}

function requiresCampusTunnel(route) {
  return route !== ROUTE_DIRECT;
}

module.exports = { normalizeOpenRequest, requiresCampusTunnel };
