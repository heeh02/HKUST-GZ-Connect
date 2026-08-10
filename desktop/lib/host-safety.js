'use strict';

const net = require('node:net');

const LOCAL_HOST_ALIASES = new Set([
  'localhost',
  'loopback',
  'localhost.localdomain',
  'localhost6',
  'localhost6.localdomain6',
]);

function normalizedHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '');
}

function isLocalHostname(host) {
  return LOCAL_HOST_ALIASES.has(host) || host.endsWith('.localhost') || host.endsWith('.local');
}

function isIsolatedNetworkHost(value) {
  const host = normalizedHost(value);
  if (!host) return false;
  if (isLocalHostname(host)) return true;
  const family = net.isIP(host);
  if (family === 6) return true;
  if (family !== 4) return false;
  const octets = host.split('.').map(Number);
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) || octets[0] >= 224;
}

// Chromium evaluates these destinations before a PAC script and silently
// bypasses the configured proxy. `proxyBypassRules: '<-loopback>'` only affects
// manual proxy settings, not PAC mode, so the isolated browser must reject the
// request at the Session boundary. All IPv6 literals are denied here: the
// current tunnel is IPv4-only, and this also covers IPv4-mapped loopback and
// link-local spellings without relying on textual IPv6 forms. HTTP(S) and
// WebSocket URLs share this boundary because Chromium exposes the latter to
// webRequest as their real ws:/wss: schemes.
function isChromiumImplicitBypassHost(value) {
  const host = normalizedHost(value);
  if (!host) return false;
  if (isLocalHostname(host)) return true;
  const family = net.isIP(host);
  if (family === 6) return true;
  if (family !== 4) return false;
  const octets = host.split('.').map(Number);
  return octets[0] === 0 || octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254);
}

function isUnsafeBrowserTargetUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol) &&
      isChromiumImplicitBypassHost(parsed.hostname);
  } catch {
    return false;
  }
}

module.exports = {
  isChromiumImplicitBypassHost,
  isIsolatedNetworkHost,
  isUnsafeBrowserTargetUrl,
};
