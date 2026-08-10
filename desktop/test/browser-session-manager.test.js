'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BrowserSessionManager,
  CAMPUS_REQUEST_FILTER,
  FAIL_CLOSED_PROXY,
  applyCampusSessionPolicy,
  campusRequestsBlocked,
  campusProxyConfig,
  pacDataUrl,
} = require('../lib/browser-session-manager');
const { CAMPUS_PARTITION, ROUTE_CAMPUS, ROUTE_DIRECT } = require('../lib/campus-route');

function validPac(port) {
  return {
    mode: 'pac_script',
    pacScript: pacDataUrl(`function FindProxyForURL(){return "SOCKS5 127.0.0.1:${port}";}`),
    proxyBypassRules: '<-loopback>',
  };
}

function pacSource(config) {
  return Buffer.from(config.pacScript.split(',').at(-1), 'base64').toString('utf8');
}

test('campus session policy denies every supported capability API', () => {
  const handlers = {};
  const browserSession = {
    setPermissionRequestHandler: (handler) => { handlers.request = handler; },
    setPermissionCheckHandler: (handler) => { handlers.check = handler; },
    setDevicePermissionHandler: (handler) => { handlers.device = handler; },
  };
  assert.equal(applyCampusSessionPolicy(browserSession), browserSession);
  let requestDecision = null;
  handlers.request({}, 'media', (allowed) => { requestDecision = allowed; });
  assert.equal(requestDecision, false);
  assert.equal(handlers.check({}, 'geolocation'), false);
  assert.equal(handlers.device({ deviceType: 'usb' }), false);
});

test('one persistent Session carries both PAC routes without redundant reconfiguration', async () => {
  const calls = [];
  const browserSession = {
    setProxy: async (config) => calls.push(['proxy', config]),
    forceReloadProxyConfig: async () => calls.push(['reload-proxy']),
    closeAllConnections: async () => calls.push(['close-connections']),
  };
  const manager = new BrowserSessionManager({
    session: {
      fromPartition: (partition) => {
        calls.push(['partition', partition]);
        return browserSession;
      },
    },
    routingPolicy: { proxyConfig: async (port) => validPac(port) },
    onSessionReady: (value) => calls.push(['ready', value]),
  });

  assert.equal(await manager.configure(6180), browserSession);
  assert.equal(await manager.configure(6180), browserSession);
  assert.equal(calls.filter(([kind]) => kind === 'proxy').length, 1);
  assert.deepEqual(calls.filter(([kind]) => kind === 'partition').map((call) => call[1]), [
    CAMPUS_PARTITION,
  ]);
  assert.equal(manager.sessionForRoute(ROUTE_CAMPUS), browserSession);
  assert.equal(manager.sessionForRoute(ROUTE_DIRECT), browserSession);
  assert.equal(manager.sessions.size, 2);
  assert.equal(new Set(manager.sessions.values()).size, 1);
  assert.equal(manager.configuredPort, 6180);

  await manager.configure(6180, { force: true });
  assert.equal(calls.filter(([kind]) => kind === 'proxy').length, 2);
  assert.equal(calls.filter(([kind]) => kind === 'reload-proxy').length, 2);
});

test('Session request boundary blocks every implicit-bypass target for every resource type once', async () => {
  const registrations = [];
  const browserSession = {
    webRequest: {
      onBeforeRequest: (filter, handler) => registrations.push({ filter, handler }),
    },
    setProxy: async () => {},
    forceReloadProxyConfig: async () => {},
    closeAllConnections: async () => {},
  };
  const manager = new BrowserSessionManager({
    session: { fromPartition: () => browserSession },
    routingPolicy: { proxyConfig: async (port) => validPac(port) },
  });
  await manager.configure(1080);
  await manager.configure(1080);
  assert.equal(registrations.length, 1, 'reconfigure must not stack request interception');
  assert.deepEqual(registrations[0].filter, CAMPUS_REQUEST_FILTER);
  assert.deepEqual(registrations[0].filter.urls, [
    'http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*',
  ]);
  assert.equal('types' in registrations[0].filter, false,
    'an omitted type filter covers main frames and every subresource type');

  const handler = registrations[0].handler;
  const decision = (url, resourceType) => new Promise((resolve) => {
    handler({ url, resourceType }, resolve);
  });
  const resourceTypes = [
    'mainFrame', 'subFrame', 'stylesheet', 'script', 'image', 'font', 'object',
    'xhr', 'ping', 'cspReport', 'media', 'webSocket', 'other',
  ];
  for (const resourceType of resourceTypes) {
    assert.deepEqual(await decision('https://localhost/private', resourceType), { cancel: true });
  }
  for (const url of [
    'http://service.local/',
    'https://x.localhost/',
    'http://loopback./admin',
    'https://localhost.localdomain/admin',
    'ws://localhost6/socket',
    'wss://localhost6.localdomain6/socket',
    'ws://127.0.0.1:9000/socket',
    'wss://[::1]/socket',
    'http://0.9.8.7/',
    'https://127.42.0.1/',
    'http://169.254.10.20/',
    'https://[::1]/',
    'https://[2001:db8::1]/',
  ]) {
    assert.deepEqual(await decision(url, 'xhr'), { cancel: true }, url);
  }
  for (const url of [
    'https://10.0.0.8/portal',
    'https://172.20.1.2/',
    'https://192.168.10.4/',
    'https://103.189.154.10:4433/',
    'https://www.hkust-gz.edu.cn/',
    'wss://103.189.154.10:4433/socket',
  ]) {
    assert.deepEqual(await decision(url, 'mainFrame'), { cancel: false }, url);
  }
});

test('session manager rejects unsafe ports, malformed PAC, and missing Electron Session', async () => {
  assert.throws(() => campusProxyConfig(1024), /端口/);
  assert.deepEqual(campusProxyConfig(1080), {
    mode: 'fixed_servers',
    proxyRules: 'socks5://127.0.0.1:1080',
    proxyBypassRules: '<-loopback>',
  });

  const malformed = new BrowserSessionManager({
    session: { fromPartition: () => ({ setProxy: async () => {} }) },
    routingPolicy: { proxyConfig: async () => ({ mode: 'direct' }) },
  });
  await assert.rejects(malformed.configure(1080), /PAC/);

  const unavailable = new BrowserSessionManager({
    routingPolicy: { proxyConfig: async (port) => validPac(port) },
  });
  await assert.rejects(unavailable.configure(1080), /Session/);

  const incompleteSession = {
    webRequest: { onBeforeRequest: () => {} },
    setProxy: async () => {},
    forceReloadProxyConfig: async () => {},
  };
  const incomplete = new BrowserSessionManager({
    session: { fromPartition: () => incompleteSession },
    routingPolicy: { proxyConfig: async (port) => validPac(port) },
  });
  await assert.rejects(incomplete.configure(1080), /安全切换/);
  assert.equal(incomplete.requestsBlocked, true,
    'missing connection draining must leave the request boundary closed');
});

test('suspend closes the request gate synchronously and installs a fail-closed PAC', async () => {
  const calls = [];
  let requestHandler = null;
  const browserSession = {
    webRequest: {
      onBeforeRequest: (_filter, handler) => { requestHandler = handler; },
    },
    setProxy: async (config) => calls.push(['proxy', config]),
    forceReloadProxyConfig: async () => calls.push(['reload']),
    closeAllConnections: async () => calls.push(['close']),
  };
  const manager = new BrowserSessionManager({
    session: { fromPartition: () => browserSession },
    routingPolicy: { proxyConfig: async (port) => validPac(port) },
  });
  await manager.configure(6180);

  let decision = null;
  requestHandler({ url: 'https://public.example/' }, (value) => { decision = value; });
  assert.deepEqual(decision, { cancel: false });

  const suspension = manager.suspend();
  decision = null;
  requestHandler({ url: 'https://public.example/' }, (value) => { decision = value; });
  assert.deepEqual(decision, { cancel: true }, 'the gate closes before the first await');
  assert.equal(manager.requestsBlocked, true);
  await suspension;

  const finalConfig = calls.filter(([kind]) => kind === 'proxy').at(-1)[1];
  assert.match(pacSource(finalConfig), new RegExp(FAIL_CLOSED_PROXY.replaceAll('.', '\\.')));
  assert.equal(calls.filter(([kind]) => kind === 'reload').length, 2);
  assert.equal(calls.filter(([kind]) => kind === 'close').length, 2);
  assert.equal(manager.suspended, true);
  assert.equal(campusRequestsBlocked(browserSession), true);
});

test('a queued resume superseded by immediate suspend can never reopen the request gate', async () => {
  const proxyConfigs = [];
  let requestHandler = null;
  let delayActiveProxy = false;
  let activeProxyStarted;
  let releaseActiveProxy;
  const activeStarted = new Promise((resolve) => { activeProxyStarted = resolve; });
  const activeBlocked = new Promise((resolve) => { releaseActiveProxy = resolve; });
  const browserSession = {
    webRequest: {
      onBeforeRequest: (_filter, handler) => { requestHandler = handler; },
    },
    setProxy: async (config) => {
      proxyConfigs.push(config);
      if (delayActiveProxy && pacSource(config).includes('SOCKS5')) {
        activeProxyStarted();
        await activeBlocked;
      }
    },
    forceReloadProxyConfig: async () => {},
    closeAllConnections: async () => {},
  };
  const manager = new BrowserSessionManager({
    session: { fromPartition: () => browserSession },
    routingPolicy: { proxyConfig: async (port) => validPac(port) },
  });
  await manager.configure(6180);
  await manager.suspend();

  delayActiveProxy = true;
  const resuming = manager.resume(6180);
  await activeStarted;
  const suspending = manager.suspend();

  let decision = null;
  requestHandler({ url: 'https://public.example/' }, (value) => { decision = value; });
  assert.deepEqual(decision, { cancel: true });
  releaseActiveProxy();
  await Promise.all([resuming, suspending]);

  decision = null;
  requestHandler({ url: 'https://public.example/' }, (value) => { decision = value; });
  assert.deepEqual(decision, { cancel: true });
  assert.equal(manager.suspended, true);
  assert.equal(manager.requestsBlocked, true);
  assert.match(pacSource(proxyConfigs.at(-1)), new RegExp(FAIL_CLOSED_PROXY.replaceAll('.', '\\.')));
});

test('a failed resume remains blocked and restores the fail-closed PAC', async () => {
  const proxyConfigs = [];
  const browserSession = {
    webRequest: { onBeforeRequest: () => {} },
    setProxy: async (config) => proxyConfigs.push(config),
    forceReloadProxyConfig: async () => {},
    closeAllConnections: async () => {},
  };
  let failPolicy = false;
  const manager = new BrowserSessionManager({
    session: { fromPartition: () => browserSession },
    routingPolicy: {
      proxyConfig: async (port) => {
        if (failPolicy) throw new Error('candidate PAC failed');
        return validPac(port);
      },
    },
  });
  await manager.configure(6180);
  await manager.suspend();
  failPolicy = true;
  await assert.rejects(manager.resume(6180), /candidate PAC failed/);
  assert.equal(manager.suspended, true);
  assert.equal(manager.requestsBlocked, true);
  assert.match(pacSource(proxyConfigs.at(-1)), new RegExp(FAIL_CLOSED_PROXY.replaceAll('.', '\\.')));
});
