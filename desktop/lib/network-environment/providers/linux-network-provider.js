'use strict';

const { mihomoOwner, unixProcessTable } = require('./proxy/mihomo-controller-provider');

function linuxRoutes(output) {
  try {
    const routes = JSON.parse(String(output || '[]'));
    return routes.filter((item) => item?.dst === 'default' && typeof item.dev === 'string')
      .map((item) => ({ interfaceId: item.dev,
        sourceAddress: typeof item.prefsrc === 'string' ? item.prefsrc : '',
        metric: Number(item.metric) || 0 })).sort((left, right) => left.metric - right.metric);
  } catch { return []; }
}

function environmentProxy(environment = {}) {
  const raw = environment.HTTPS_PROXY || environment.https_proxy ||
    environment.HTTP_PROXY || environment.http_proxy || environment.ALL_PROXY || environment.all_proxy;
  if (!raw) return { state: 'unknown', type: 'unknown', endpoint: null, owner: {} };
  try {
    const parsed = new URL(raw);
    return { state: 'detected', type: parsed.protocol.startsWith('socks') ? 'socks' : 'http',
      endpoint: { host: parsed.hostname, port: Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80) },
      owner: { provider: 'environment', name: 'Environment proxy', mode: 'unknown', confidence: 'confirmed' } };
  } catch { return { state: 'unknown', type: 'unknown', endpoint: null, owner: {} }; }
}

async function firstCommand(run, commands, args) {
  for (const command of commands) {
    const value = await run(command, args);
    if (value) return value;
  }
  return '';
}

function unquote(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/gu, '');
}

async function gnomeProxy(run) {
  const commands = ['/usr/bin/gsettings', '/usr/local/bin/gsettings', 'gsettings'];
  const output = await firstCommand(run, commands, ['list-recursively', 'org.gnome.system.proxy']);
  if (!output) return null;
  const values = new Map(String(output).split(/\r?\n/u).map((line) => {
    const match = line.match(/^(org\.gnome\.system\.proxy(?:\.[a-z]+)?)\s+([a-z-]+)\s+(.+)$/u);
    return match ? [`${match[1]} ${match[2]}`, unquote(match[3])] : null;
  }).filter(Boolean));
  const mode = values.get('org.gnome.system.proxy mode');
  if (mode === 'none') return { state: 'disabled', type: 'unknown', endpoint: null, owner: {} };
  if (mode === 'auto') return { state: 'detected', type: 'pac', endpoint: null,
    owner: { provider: 'gnome', name: 'GNOME proxy', mode: 'unknown', confidence: 'confirmed' } };
  if (mode !== 'manual') return null;
  for (const type of ['https', 'http', 'socks']) {
    const schema = `org.gnome.system.proxy.${type}`;
    const host = values.get(`${schema} host`) || '';
    const port = Number(values.get(`${schema} port`));
    if (host && Number.isInteger(port) && port > 0) {
      return { state: 'detected', type: type === 'socks' ? 'socks' : 'http',
        endpoint: { host, port }, owner: {} };
    }
  }
  return { state: 'unknown', type: 'unknown', endpoint: null, owner: {} };
}

async function detectLinux({ interfaces, run, environment }) {
  const [routeOutput, desktopProxy, processOutput] = await Promise.all([
    firstCommand(run, ['/usr/sbin/ip', '/usr/bin/ip', '/sbin/ip', 'ip'],
      ['-j', 'route', 'show', 'default']),
    gnomeProxy(run),
    firstCommand(run, ['/bin/ps', '/usr/bin/ps', 'ps'], ['-axo', 'pid=,comm=,args=']),
  ]);
  const routes = linuxRoutes(routeOutput);
  const systemRoute = routes[0] || null;
  const physicalRoute = routes.find((route) => interfaces.some((item) => (
    item.id === route.interfaceId && item.kind === 'physical'
  ))) || null;
  const processProxy = environmentProxy(environment);
  const proxy = desktopProxy?.state === 'detected' ? desktopProxy :
    processProxy.state === 'detected' ? processProxy : desktopProxy || processProxy;
  const processes = unixProcessTable(processOutput);
  const owner = await mihomoOwner({ processes, endpoint: proxy.endpoint, run, platform: 'linux' });
  return { platform: 'linux', status: physicalRoute ? 'ready' : 'partial',
    interfaces: interfaces.map((item) => ({ ...item, default: item.id === physicalRoute?.interfaceId,
      systemDefault: item.id === systemRoute?.interfaceId })),
    defaultRoute: physicalRoute,
    systemRoute,
    systemProxy: { ...proxy, owner: owner || proxy.owner } };
}

module.exports = { detectLinux, environmentProxy, firstCommand, gnomeProxy, linuxRoutes };
