'use strict';

const { mihomoOwner, unixProcessTable } = require('./proxy/mihomo-controller-provider');

function defaultInterface(output) {
  return String(output || '').match(/^\s*interface:\s*([A-Za-z0-9_.:-]+)\s*$/mu)?.[1] || '';
}

function defaultInterfaces(output) {
  return String(output || '').split(/\r?\n/u).map((line) => line.trim().split(/\s+/u))
    .filter((parts) => parts[0] === 'default' && /^[A-Za-z0-9_.:-]+$/u.test(parts.at(-1) || ''))
    .map((parts) => parts.at(-1));
}

function hardwareNames(output) {
  const names = new Map();
  let label = '';
  for (const line of String(output || '').split(/\r?\n/u)) {
    const hardware = line.match(/^Hardware Port:\s*(.+)$/u);
    const device = line.match(/^Device:\s*([A-Za-z0-9_.:-]+)$/u);
    if (hardware) label = hardware[1].trim();
    if (device && label) { names.set(device[1], label); label = ''; }
  }
  return names;
}

function systemProxy(output) {
  const values = new Map([...String(output || '').matchAll(/^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/gmu)]
    .map((match) => [match[1], match[2]]));
  for (const prefix of ['HTTPS', 'HTTP', 'SOCKS']) {
    if (values.get(`${prefix}Enable`) !== '1') continue;
    const host = values.get(`${prefix}Proxy`) || '';
    const port = Number(values.get(`${prefix}Port`));
    if (host && Number.isInteger(port) && port > 0) {
      return { state: 'detected', type: prefix === 'SOCKS' ? 'socks' : 'http',
        endpoint: { host, port }, owner: {} };
    }
  }
  if (values.get('ProxyAutoConfigEnable') === '1') {
    return { state: 'detected', type: 'pac', endpoint: null, owner: {} };
  }
  return { state: 'disabled', type: 'unknown', endpoint: null, owner: {} };
}

function detectMacos({ interfaces, run }) {
  const systemDefaultId = defaultInterface(run('/sbin/route', ['-n', 'get', 'default']));
  const names = hardwareNames(run('/usr/sbin/networksetup', ['-listallhardwareports']));
  const routeInterfaces = defaultInterfaces(run('/usr/sbin/netstat', ['-rn', '-f', 'inet']));
  const physicalDefaultId = routeInterfaces.find((id) => names.has(id)) ||
    (names.has(systemDefaultId) ? systemDefaultId : '');
  const proxy = systemProxy(run('/usr/sbin/scutil', ['--proxy']));
  const processes = unixProcessTable(run('/bin/ps', ['-axo', 'pid=,comm=,args=']));
  const owner = mihomoOwner({ processes, endpoint: proxy.endpoint, run, platform: 'darwin' });
  const projected = interfaces.map((item) => ({ ...item,
    name: names.get(item.id) || item.name,
    kind: names.has(item.id) ? 'physical' : item.kind,
    default: item.id === physicalDefaultId,
    systemDefault: item.id === systemDefaultId,
  }));
  return { platform: 'darwin', status: physicalDefaultId ? 'ready' : 'partial', interfaces: projected,
    systemProxy: { ...proxy, owner: owner || proxy.owner } };
}

module.exports = { defaultInterface, defaultInterfaces, detectMacos, hardwareNames, systemProxy };
