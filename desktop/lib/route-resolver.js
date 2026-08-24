'use strict';

const {
  DIRECT_PARTNER_HOSTS,
  ROUTE_CAMPUS,
  ROUTE_DIRECT,
  SCHOOL_CAMPUS_HOSTS,
  hostMatches,
} = require('./campus-route');
const { normalizeRoutingRules, normalizeRuleHost } = require('./routing-rule-store');
const { isIsolatedNetworkHost } = require('./host-safety');

function hostnameForUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

function result(route, source, rule = null) {
  return {
    route,
    source,
    matchedRule: rule
      ? { host: rule.host, includeSubdomains: rule.includeSubdomains }
      : null,
  };
}

function resourceMatch(host, resources) {
  for (const resource of Array.isArray(resources) ? resources : []) {
    if (!resource || (resource.route !== ROUTE_CAMPUS && resource.route !== ROUTE_DIRECT)) continue;
    const resourceHost = hostnameForUrl(resource.url);
    if (resourceHost && resourceHost === host) return resource;
  }
  return null;
}

function schoolDomainMatch(host, domains) {
  for (const value of Array.isArray(domains) ? domains : []) {
    try {
      const domain = normalizeRuleHost(String(value));
      if (hostMatches(host, domain)) return true;
    } catch {}
  }
  return false;
}

function resolveRouteForUrl(rawUrl, {
  userRules = [],
  customResources = [],
  schoolDomains = SCHOOL_CAMPUS_HOSTS,
  directPartnerDomains = DIRECT_PARTNER_HOSTS,
  serverResources = [],
  inheritedRoute = null,
} = {}) {
  const host = hostnameForUrl(rawUrl);
  if (!host) return result(ROUTE_CAMPUS, 'default');
  // A web page must never use a user "direct" rule to reach this computer or
  // the surrounding LAN. Private campus destinations still work through the
  // isolated tunnel, whose destination policy is enforced again in Rust.
  if (isIsolatedNetworkHost(host)) return result(ROUTE_CAMPUS, 'safety');

  const rules = normalizeRoutingRules(userRules);
  const exact = rules.find((rule) => !rule.includeSubdomains && rule.host === host);
  if (exact) return result(exact.route, 'user-exact', exact);

  const suffix = rules
    .filter((rule) => rule.includeSubdomains && hostMatches(host, rule.host))
    .sort((left, right) => right.host.length - left.host.length || right.updatedAt - left.updatedAt)[0];
  if (suffix) return result(suffix.route, 'user-subdomain', suffix);

  const custom = resourceMatch(host, customResources);
  if (custom) return result(custom.route, 'custom-resource');

  if (schoolDomainMatch(host, directPartnerDomains)) return result(ROUTE_DIRECT, 'builtin');
  if (schoolDomainMatch(host, schoolDomains)) return result(ROUTE_CAMPUS, 'builtin');
  const server = resourceMatch(host, serverResources);
  if (server) return result(server.route, 'server-resource');
  if (inheritedRoute === ROUTE_CAMPUS || inheritedRoute === ROUTE_DIRECT) {
    return result(inheritedRoute, 'inherited');
  }
  return result(ROUTE_CAMPUS, 'default');
}

module.exports = {
  hostnameForUrl,
  resolveRouteForUrl,
  resourceMatch,
  schoolDomainMatch,
};
