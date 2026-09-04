'use strict';

const net = require('node:net');

function kindOf(id, platform) {
  if (/^(?:lo|lo0)$/u.test(id)) return 'loopback';
  if (/^(?:utun|tun|tap|wg|tailscale|ppp|ipsec|vEthernet|Wintun)/iu.test(id)) return 'virtual';
  if (platform === 'linux' && /^(?:en|eth|wl|wlan|wwan|usb)/iu.test(id)) return 'physical';
  if (platform === 'win32' && /virtual|vpn|hyper-v|wsl|loopback/iu.test(id)) return 'virtual';
  return 'unknown';
}

function inventoryFromNode(networkInterfaces, platform) {
  return Object.entries(networkInterfaces || {}).map(([id, values]) => ({
    id,
    name: id,
    kind: kindOf(id, platform),
    active: Array.isArray(values) && values.some(({ internal, address }) => !internal && net.isIP(address)),
    default: false,
    systemDefault: false,
    addresses: (Array.isArray(values) ? values : []).map(({ address, family, internal }) => ({
      address, family: family === 'IPv6' || family === 6 ? 6 : 4, internal: internal === true,
    })),
  }));
}

module.exports = { inventoryFromNode, kindOf };
