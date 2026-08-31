'use strict';

const { ROUTE_CAMPUS, ROUTE_DIRECT, routeForUrl } = require('../../routing/policy/campus-route');
const { BLANK_CAMPUS_HOME, normalizeCampusUrl } = require('../session/campus-browser');

function normalizeOpenRequest(input, t, fallback) {
  const source = input && typeof input === 'object' ? input : { url: input };
  const url = normalizeCampusUrl(source.url, fallback, t);
  const route = url === BLANK_CAMPUS_HOME
    ? ROUTE_DIRECT
    : [ROUTE_CAMPUS, ROUTE_DIRECT].includes(source.route)
    ? source.route
    : routeForUrl(url);
  let displayName = '';
  if (source.displayName != null) {
    if (typeof source.displayName !== 'string' || !source.displayName.trim() ||
        source.displayName.trim().length > 96 || /[\u0000-\u001f\u007f<>]/u.test(source.displayName)) {
      throw new TypeError('Campus Browser display name is invalid');
    }
    displayName = source.displayName.trim();
  }
  return displayName ? { url, route, displayName } : { url, route };
}

function requiresCampusTunnel(route) {
  return route !== ROUTE_DIRECT;
}

module.exports = { normalizeOpenRequest, requiresCampusTunnel };
