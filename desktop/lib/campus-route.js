'use strict';

const ROUTE_CAMPUS = 'campus';
const ROUTE_DIRECT = 'direct';
const CAMPUS_PARTITION = 'persist:hkustgz-campus-browser';
const DIRECT_PARTITION = 'persist:hkustgz-direct-browser';

const DIRECT_PARTNER_HOSTS = Object.freeze([
  'outlook.office.com',
  'hkust-gz.instructure.com',
]);

function validRoute(route) {
  return route === ROUTE_CAMPUS || route === ROUTE_DIRECT;
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function routeForUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/\.$/, '');
    return DIRECT_PARTNER_HOSTS.some((domain) => hostMatches(host, domain))
      ? ROUTE_DIRECT
      : ROUTE_CAMPUS;
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
  ROUTE_CAMPUS,
  ROUTE_DIRECT,
  partitionForRoute,
  proxyConfigForRoute,
  routeForUrl,
};
