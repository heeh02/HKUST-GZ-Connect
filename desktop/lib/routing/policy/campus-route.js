'use strict';

const ROUTE_CAMPUS = 'campus';
const ROUTE_DIRECT = 'direct';
const CAMPUS_PARTITION = 'persist:hkustgz-campus-browser';
const DIRECT_PARTITION = 'persist:hkustgz-direct-browser';
const NEUTRAL_CAMPUS_PARTITION = 'persist:campus-workspace-neutral';

const DIRECT_PARTNER_HOSTS = Object.freeze([
  'outlook.office.com',
  'microsoftonline.com',
  'microsoftonline-p.com',
  'msauth.net',
  'msftauth.net',
  'office.com',
  'office.net',
  'hkust-gz.instructure.com',
  'instructure.com',
  'instructuremedia.com',
]);
const SCHOOL_CAMPUS_HOSTS = Object.freeze([
  'hkust-gz.edu.cn',
  'hkust.edu.hk',
]);

function validRoute(route) {
  return route === ROUTE_CAMPUS || route === ROUTE_DIRECT;
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function builtinRouteForHost(rawHost) {
  const host = String(rawHost || '').toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  if (DIRECT_PARTNER_HOSTS.some((domain) => hostMatches(host, domain))) return ROUTE_DIRECT;
  if (SCHOOL_CAMPUS_HOSTS.some((domain) => hostMatches(host, domain))) return ROUTE_CAMPUS;
  return null;
}

function routeForUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/\.$/, '');
    return builtinRouteForHost(host) || ROUTE_CAMPUS;
  } catch {
    return ROUTE_CAMPUS;
  }
}

function proxyConfigForRoute(route, port) {
  if (!validRoute(route)) throw new Error('浏览器网络路径无效');
  if (route === ROUTE_DIRECT) return { mode: 'direct' };
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1025 || value > 65535) {
    throw new Error('本地代理端口无效');
  }
  return {
    mode: 'fixed_servers',
    proxyRules: `socks5://127.0.0.1:${value}`,
    proxyBypassRules: '<-loopback>',
  };
}

function partitionForRoute(route) {
  if (route === ROUTE_CAMPUS) return CAMPUS_PARTITION;
  if (route === ROUTE_DIRECT) return DIRECT_PARTITION;
  throw new Error('浏览器网络路径无效');
}

module.exports = {
  CAMPUS_PARTITION,
  DIRECT_PARTNER_HOSTS,
  DIRECT_PARTITION,
  NEUTRAL_CAMPUS_PARTITION,
  ROUTE_CAMPUS,
  ROUTE_DIRECT,
  SCHOOL_CAMPUS_HOSTS,
  builtinRouteForHost,
  hostMatches,
  partitionForRoute,
  proxyConfigForRoute,
  routeForUrl,
};
