'use strict';

const { domainToASCII } = require('url');

const DEFAULT_ROUTE_DOMAINS = Object.freeze([
  'hkust-gz.edu.cn',
  'hkust.edu.hk',
]);
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

function buildPac(routeDomains, port) {
  const domains = normalizeRouteDomains(routeDomains);
  const proxyPort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 1080;
  return `'use strict';
var ROUTE_DOMAINS = ${JSON.stringify(domains)};
function FindProxyForURL(url, host) {
  host = String(host || "").toLowerCase().replace(/\\.$/, "");
  if (host.slice(0, 3) === "10.") return "SOCKS5 127.0.0.1:${proxyPort}";
  for (var i = 0; i < ROUTE_DOMAINS.length; i++) {
    var domain = ROUTE_DOMAINS[i];
    if (host === domain ||
        (host.length > domain.length &&
         host.slice(-(domain.length + 1)) === "." + domain))
      return "SOCKS5 127.0.0.1:${proxyPort}";
  }
  return "DIRECT";
}
`;
}

module.exports = { DEFAULT_ROUTE_DOMAINS, buildPac, normalizeRouteDomains };
