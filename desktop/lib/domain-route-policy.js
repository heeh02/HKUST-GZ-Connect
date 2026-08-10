'use strict';

const {
  DIRECT_PARTNER_HOSTS,
  ROUTE_CAMPUS,
  ROUTE_DIRECT,
  SCHOOL_CAMPUS_HOSTS,
} = require('./campus-route');
const { hostnameForUrl, resolveRouteForUrl } = require('./route-resolver');
const { isIsolatedNetworkHost } = require('./host-safety');
const {
  deleteRoutingRule,
  loadRoutingRules,
  normalizeRoutingRules,
  normalizeRuleHost,
  saveRoutingRules,
  upsertRoutingRule,
} = require('./routing-rule-store');

const POLICY_SOURCES = Object.freeze([
  'safety',
  'user-exact',
  'user-subdomain',
  'custom-resource',
  'builtin',
  'server-resource',
  'inherited',
  'default',
]);

function validRoute(route) {
  return route === ROUTE_CAMPUS || route === ROUTE_DIRECT;
}

function normalizeDomains(values, fallback = []) {
  const result = [];
  for (const value of Array.isArray(values) ? values : fallback) {
    try {
      const host = normalizeRuleHost(String(value));
      if (!result.includes(host)) result.push(host);
    } catch {}
  }
  return result;
}

function normalizeResourceRoutes(resources) {
  const seen = new Set();
  const result = [];
  for (const resource of Array.isArray(resources) ? resources : []) {
    if (!resource || !validRoute(resource.route)) continue;
    const host = hostnameForUrl(resource.url);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    result.push({
      host,
      route: resource.route === ROUTE_DIRECT && isIsolatedNetworkHost(host)
        ? ROUTE_CAMPUS
        : resource.route,
    });
  }
  return result;
}

function normalizeDomainRoutePolicy({
  userRules = [],
  customResources = [],
  schoolDomains = SCHOOL_CAMPUS_HOSTS,
  serverResources = [],
} = {}) {
  const rules = normalizeRoutingRules(userRules);
  return {
    userExact: rules
      .filter((rule) => !rule.includeSubdomains)
      .map(({ host, route }) => ({ host, route })),
    userSubdomains: rules
      .filter((rule) => rule.includeSubdomains)
      .sort((left, right) => right.host.length - left.host.length || right.updatedAt - left.updatedAt)
      .map(({ host, route }) => ({ host, route })),
    customExact: normalizeResourceRoutes(customResources),
    builtinSubdomains: [
      ...normalizeDomains(DIRECT_PARTNER_HOSTS).map((host) => ({ host, route: ROUTE_DIRECT })),
      ...normalizeDomains(schoolDomains, SCHOOL_CAMPUS_HOSTS)
        .map((host) => ({ host, route: ROUTE_CAMPUS })),
    ],
    serverExact: normalizeResourceRoutes(serverResources),
  };
}

function resolveDomainRouteForUrl(rawUrl, options = {}) {
  return resolveRouteForUrl(rawUrl, options);
}

function buildDomainRoutePac(options = {}, port, {
  defaultRoute = ROUTE_CAMPUS,
  campusPrivateIpv4 = false,
  proxyKind = 'socks5',
} = {}) {
  const proxyPort = Number(port);
  if (!Number.isInteger(proxyPort) || proxyPort < 1025 || proxyPort > 65535) {
    throw new Error('本地代理端口无效');
  }
  if (!validRoute(defaultRoute)) throw new Error('默认浏览器网络路径无效');
  if (!['socks5', 'http'].includes(proxyKind)) throw new Error('本地代理类型无效');
  const policy = normalizeDomainRoutePolicy(options);
  const proxy = `${proxyKind === 'http' ? 'PROXY' : 'SOCKS5'} 127.0.0.1:${proxyPort}`;
  return `'use strict';
var USER_EXACT = ${JSON.stringify(policy.userExact)};
var USER_SUBDOMAINS = ${JSON.stringify(policy.userSubdomains)};
var CUSTOM_EXACT = ${JSON.stringify(policy.customExact)};
var BUILTIN_SUBDOMAINS = ${JSON.stringify(policy.builtinSubdomains)};
var SERVER_EXACT = ${JSON.stringify(policy.serverExact)};
var DEFAULT_ROUTE = ${JSON.stringify(defaultRoute)};
var CAMPUS_PRIVATE_IPV4 = ${campusPrivateIpv4 === true ? 'true' : 'false'};
function exactRoute(entries, host) {
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].host === host) return entries[i].route;
  }
  return "";
}
function suffixRoute(entries, host) {
  for (var i = 0; i < entries.length; i++) {
    var domain = entries[i].host;
    if (host === domain ||
        (host.length > domain.length && host.slice(-(domain.length + 1)) === "." + domain))
      return entries[i].route;
  }
  return "";
}
function forceCampusHost(host) {
  if (host === "localhost" || host.slice(-10) === ".localhost" ||
      host.slice(-6) === ".local" || host.indexOf(":") !== -1) return true;
  var parts = host.split(".");
  if (parts.length !== 4) return false;
  var octets = [];
  for (var i = 0; i < parts.length; i++) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(parts[i])) return false;
    var octet = Number(parts[i]);
    if (octet > 255) return false;
    octets.push(octet);
  }
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) || octets[0] >= 224;
}
function FindProxyForURL(url, host) {
  host = String(host || "").toLowerCase().replace(/\\.$/, "");
  if (CAMPUS_PRIVATE_IPV4 && forceCampusHost(host)) return ${JSON.stringify(proxy)};
  var route = exactRoute(USER_EXACT, host)
    || suffixRoute(USER_SUBDOMAINS, host)
    || exactRoute(CUSTOM_EXACT, host);
  route = route || suffixRoute(BUILTIN_SUBDOMAINS, host)
    || exactRoute(SERVER_EXACT, host)
    || DEFAULT_ROUTE;
  return route === "direct" ? "DIRECT" : ${JSON.stringify(proxy)};
}
`;
}

class DomainRoutePolicyStore {
  constructor({
    filePath,
    customResources = () => [],
    schoolDomains = () => SCHOOL_CAMPUS_HOSTS,
    serverResources = () => [],
  } = {}) {
    if (typeof filePath !== 'string' || !filePath) {
      throw new TypeError('路由规则文件路径无效');
    }
    this.filePath = filePath;
    this.customResources = typeof customResources === 'function'
      ? customResources
      : () => customResources;
    this.schoolDomains = typeof schoolDomains === 'function'
      ? schoolDomains
      : () => schoolDomains;
    this.serverResources = typeof serverResources === 'function'
      ? serverResources
      : () => serverResources;
  }

  list() {
    return loadRoutingRules(this.filePath);
  }

  options() {
    return {
      userRules: this.list(),
      customResources: this.customResources(),
      schoolDomains: this.schoolDomains(),
      serverResources: this.serverResources(),
    };
  }

  resolve(rawUrl, inheritedRoute = null) {
    return resolveDomainRouteForUrl(rawUrl, { ...this.options(), inheritedRoute });
  }

  upsert(payload, now = Date.now()) {
    let current = this.list();
    if (payload?.previous) {
      current = deleteRoutingRule(
        current,
        payload.previous.host,
        payload.previous.includeSubdomains === true,
      );
    }
    const result = upsertRoutingRule(current, payload, now);
    const rules = saveRoutingRules(this.filePath, result.rules);
    return { rule: result.rule, rules };
  }

  remove({ host, includeSubdomains = false } = {}) {
    return saveRoutingRules(
      this.filePath,
      deleteRoutingRule(this.list(), host, includeSubdomains),
    );
  }

  replace(rules) {
    return saveRoutingRules(this.filePath, rules);
  }

  buildPac(port, config) {
    return buildDomainRoutePac(this.options(), port, config);
  }
}

module.exports = {
  DomainRoutePolicyStore,
  POLICY_SOURCES,
  buildDomainRoutePac,
  normalizeDomainRoutePolicy,
  normalizeResourceRoutes,
  resolveDomainRouteForUrl,
};
