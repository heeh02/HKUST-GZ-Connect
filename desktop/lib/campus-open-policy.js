'use strict';

const { ROUTE_CAMPUS, ROUTE_DIRECT, routeForUrl } = require('./campus-route');
const { BLANK_CAMPUS_HOME, normalizeCampusUrl } = require('./campus-browser');

function normalizeOpenRequest(input, t, fallback) {
  const source = input && typeof input === 'object' ? input : { url: input };
  const url = normalizeCampusUrl(source.url, fallback, t);
  const route = url === BLANK_CAMPUS_HOME
    ? ROUTE_DIRECT
    : [ROUTE_CAMPUS, ROUTE_DIRECT].includes(source.route)
    ? source.route
    : routeForUrl(url);
  return { url, route };
}

function requiresCampusTunnel(route) {
  return route !== ROUTE_DIRECT;
}

module.exports = { normalizeOpenRequest, requiresCampusTunnel };
