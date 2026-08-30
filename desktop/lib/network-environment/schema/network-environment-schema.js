'use strict';

const net = require('node:net');

const ID = /^[A-Za-z0-9_.:-]{1,64}$/u;
const KINDS = new Set(['physical', 'virtual', 'loopback', 'unknown']);
const PROXY_MODES = new Set(['direct', 'rule', 'global', 'script', 'unknown']);
const safeText = (value, max = 96) => typeof value === 'string' && value.trim() &&
  value.length <= max && !/[\u0000-\u001f\u007f<>]/u.test(value) ? value.trim() : '';

function address(value) {
  const source = value && typeof value === 'object' ? value : {};
  const ip = safeText(source.address, 64);
  if (!net.isIP(ip)) return null;
  const internal = source.internal === true;
  return Object.freeze({ address: ip, family: net.isIP(ip), internal,
    selectable: !internal && usableSourceAddress(ip) });
}

function usableSourceAddress(value) {
  const family = net.isIP(value);
  if (family === 4) {
    const first = Number(String(value).split('.')[0]);
    return value !== '0.0.0.0' && !value.startsWith('127.') && !value.startsWith('169.254.') && first < 224;
  }
  if (family === 6) {
    const normalized = String(value).toLowerCase();
    return normalized !== '::' && normalized !== '::1' && !normalized.startsWith('fe8') &&
      !normalized.startsWith('fe9') && !normalized.startsWith('fea') &&
      !normalized.startsWith('feb') && !normalized.startsWith('ff');
  }
  return false;
}

function networkInterface(value) {
  const source = value && typeof value === 'object' ? value : {};
  const id = safeText(source.id, 64);
  if (!ID.test(id)) return null;
  const addresses = [...new Map((Array.isArray(source.addresses) ? source.addresses : [])
    .map(address).filter(Boolean).map((item) => [item.address, item])).values()].slice(0, 16);
  return Object.freeze({
    id,
    name: safeText(source.name, 96) || id,
    kind: KINDS.has(source.kind) ? source.kind : 'unknown',
    active: source.active === true,
    default: source.default === true,
    systemDefault: source.systemDefault === true,
    addresses: Object.freeze(addresses),
  });
}

function routeFor(networkInterface, preferredAddress = '') {
  if (!networkInterface) return null;
  const candidates = networkInterface.addresses.filter(({ selectable }) => selectable);
  const preferred = candidates.find(({ address: candidate }) => candidate === preferredAddress)?.address;
  return Object.freeze({
    interfaceId: networkInterface.id,
    sourceAddress: preferred || candidates.find(({ family }) => family === 4)?.address ||
      candidates[0]?.address || '',
  });
}

function proxy(value) {
  const source = value && typeof value === 'object' ? value : {};
  const endpoint = source.endpoint && typeof source.endpoint === 'object' ? source.endpoint : {};
  const host = safeText(endpoint.host, 253);
  const port = Number(endpoint.port);
  const owner = source.owner && typeof source.owner === 'object' ? source.owner : {};
  return Object.freeze({
    state: ['detected', 'disabled', 'unknown'].includes(source.state) ? source.state : 'unknown',
    type: ['http', 'socks', 'pac', 'mixed', 'unknown'].includes(source.type) ? source.type : 'unknown',
    endpoint: host && Number.isInteger(port) && port > 0 && port <= 65535
      ? Object.freeze({ host, port }) : null,
    owner: Object.freeze({
      provider: safeText(owner.provider, 64) || 'unknown',
      name: safeText(owner.name, 96),
      mode: PROXY_MODES.has(owner.mode) ? owner.mode : 'unknown',
      tunEnabled: typeof owner.tunEnabled === 'boolean' ? owner.tunEnabled : null,
      confidence: ['confirmed', 'observed', 'unknown'].includes(owner.confidence)
        ? owner.confidence : 'unknown',
    }),
  });
}

function projectNetworkEnvironment(value = {}, selection = '') {
  const source = value && typeof value === 'object' ? value : {};
  const interfaces = (Array.isArray(source.interfaces) ? source.interfaces : [])
    .map(networkInterface).filter(Boolean).slice(0, 64);
  const selectedAddress = safeText(selection, 64);
  const selected = usableSourceAddress(selectedAddress) ? interfaces.find((item) => (
    item.addresses.some(({ address: candidate }) => candidate === selectedAddress)
  )) : null;
  const defaultInterface = interfaces.find((item) => item.default) || null;
  const systemDefaultInterface = interfaces.find((item) => item.systemDefault) || defaultInterface;
  return Object.freeze({
    schemaVersion: 1,
    platform: ['darwin', 'win32', 'linux'].includes(source.platform) ? source.platform : 'unknown',
    status: ['ready', 'partial', 'unknown'].includes(source.status) ? source.status : 'unknown',
    interfaces: Object.freeze(interfaces),
    defaultRoute: routeFor(defaultInterface, source.defaultRoute?.sourceAddress),
    systemRoute: routeFor(systemDefaultInterface, source.systemRoute?.sourceAddress),
    systemProxy: proxy(source.systemProxy),
    selection: Object.freeze({
      mode: selected ? 'selected' : 'default',
      interfaceId: selected?.id || defaultInterface?.id || '',
      sourceAddress: selectedAddress && selected ? selectedAddress : '',
      available: !selectedAddress || Boolean(selected),
    }),
  });
}

module.exports = { projectNetworkEnvironment, usableSourceAddress };
