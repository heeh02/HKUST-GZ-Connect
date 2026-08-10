'use strict';

const { domainToASCII } = require('url');
const { ROUTE_DIRECT, SCHOOL_CAMPUS_HOSTS } = require('./campus-route');
const { buildDomainRoutePac } = require('./domain-route-policy');

const DEFAULT_ROUTE_DOMAINS = SCHOOL_CAMPUS_HOSTS;
const MAX_ROUTE_DOMAINS = 64;

function normalizeRouteDomains(input) {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,;]+/)
      : DEFAULT_ROUTE_DOMAINS;
  const normalized = [];
  for (const value of values) {
    const candidate = String(value)
      .trim()
      .toLowerCase()
      .replace(/^\*\./, '')
      .replace(/^\.+|\.+$/g, '');
    if (!candidate || /[\\/?#:@[\]%]/.test(candidate)) continue;
    const domain = domainToASCII(candidate);
    if (!domain
      || domain.length > 253
      || domain.split('.').some((label) =>
        !label
        || label.length > 63
        || !/^[a-z0-9-]+$/.test(label)
        || label.startsWith('-')
        || label.endsWith('-'))
      || normalized.includes(domain)) {
      continue;
    }
    normalized.push(domain);
    if (normalized.length >= MAX_ROUTE_DOMAINS) break;
  }
  return normalized.length ? normalized : [...DEFAULT_ROUTE_DOMAINS];
}

function buildPac(routeDomains, port, options = {}) {
  const domains = normalizeRouteDomains(routeDomains);
  const proxyPort = Number.isInteger(port) && port >= 1025 && port <= 65535 ? port : 1080;
  return buildDomainRoutePac({ ...options, schoolDomains: domains }, proxyPort, {
    defaultRoute: ROUTE_DIRECT,
    campusPrivateIpv4: true,
  });
}

module.exports = { DEFAULT_ROUTE_DOMAINS, buildPac, normalizeRouteDomains };
