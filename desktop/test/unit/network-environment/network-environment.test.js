'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { detectLinux } = require('../../../lib/network-environment/providers/linux-network-provider');
const { detectMacos } = require('../../../lib/network-environment/providers/macos-network-provider');
const { detectWindows } = require('../../../lib/network-environment/providers/windows-network-provider');
const { mihomoOwner } = require('../../../lib/network-environment/providers/proxy/mihomo-controller-provider');
const { createCommandRunner } = require('../../../lib/network-environment/platform/command-runner');
const { NetworkEnvironmentService } = require('../../../lib/network-environment/runtime/network-environment-service');
const { projectNetworkEnvironment, usableSourceAddress } =
  require('../../../lib/network-environment/schema/network-environment-schema');

const address = (value) => ({ address: value, family: 4, internal: false });

test('platform commands complete asynchronously and collapse failures to unknown output', async () => {
  let callback = null;
  const run = createCommandRunner({ exec: (_command, _args, _options, done) => { callback = done; } });
  let settled = false;
  const pending = run('/usr/bin/example').then((value) => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false, 'platform command execution must not block Main');
  callback(null, 'ready\n');
  assert.equal(await pending, 'ready\n');

  const failed = createCommandRunner({ exec: (_command, _args, _options, done) => {
    done(new Error('unavailable'), 'partial');
  } });
  assert.equal(await failed('/usr/bin/missing'), '');
});

test('macOS separates the system TUN route from the default physical underlay', async () => {
  const interfaces = [
    { id: 'en0', name: 'en0', kind: 'unknown', active: true, addresses: [address('10.0.0.8')] },
    { id: 'utun4', name: 'utun4', kind: 'virtual', active: true, addresses: [address('100.64.0.2')] },
  ];
  const run = (command, args) => {
    const call = `${command} ${args.join(' ')}`;
    if (call.startsWith('/sbin/route')) return 'interface: utun4\n';
    if (call.includes('networksetup')) return 'Hardware Port: Wi-Fi\nDevice: en0\n';
    if (call.includes('netstat')) return 'default 10.0.0.1 UGSc en0\ndefault link#22 UCS utun4\n';
    if (call.includes('scutil')) return 'HTTPEnable : 1\nHTTPProxy : 127.0.0.1\nHTTPPort : 7890\n';
    if (call.startsWith('/bin/ps')) return '42 /opt/mihomo mihomo -ext-ctl-unix /tmp/mihomo-test.sock\n';
    if (call.includes('curl')) return JSON.stringify({ mode: 'rule', 'mixed-port': 7890,
      tun: { enable: false } });
    return '';
  };
  const result = await detectMacos({ interfaces, run });
  assert.equal(result.interfaces.find(({ id }) => id === 'en0').default, true);
  assert.equal(result.interfaces.find(({ id }) => id === 'utun4').systemDefault, true);
  assert.deepEqual(result.systemProxy.owner, { provider: 'mihomo', name: 'Mihomo / Clash', mode: 'rule',
    tunEnabled: false, confidence: 'confirmed' });
});

test('Linux detects physical underlay, TUN system route, desktop proxy, and advertised Mihomo mode', async () => {
  const interfaces = [
    { id: 'eth0', name: 'eth0', kind: 'physical', active: true, addresses: [address('192.0.2.8')] },
    { id: 'tun0', name: 'tun0', kind: 'virtual', active: true, addresses: [address('100.64.0.5')] },
  ];
  const run = (command, args) => {
    const call = `${command} ${args.join(' ')}`;
    if (args.includes('route')) return JSON.stringify([
      { dst: 'default', dev: 'tun0', metric: 5 }, { dst: 'default', dev: 'eth0', metric: 100 },
    ]);
    if (call.includes('list-recursively')) return [
      "org.gnome.system.proxy mode 'manual'",
      "org.gnome.system.proxy.https host '127.0.0.1'",
      'org.gnome.system.proxy.https port 7890',
    ].join('\n');
    if (args.includes('-axo')) return '51 /usr/bin/mihomo mihomo --external-controller 127.0.0.1:9090\n';
    if (call.includes('curl') && call.includes('/configs')) {
      return JSON.stringify({ mode: 'global', 'mixed-port': 7890, tun: { enable: true } });
    }
    return '';
  };
  const result = await detectLinux({ interfaces, run, environment: {} });
  assert.equal(result.interfaces.find(({ id }) => id === 'eth0').default, true);
  assert.equal(result.interfaces.find(({ id }) => id === 'tun0').systemDefault, true);
  assert.equal(result.systemProxy.owner.mode, 'global');
  assert.equal(result.systemProxy.owner.tunEnabled, true);
});

test('Windows uses interface indices as safe IDs and separates Wintun from hardware underlay', async () => {
  const interfaces = [
    { id: 'Ethernet 2', name: 'Ethernet 2', kind: 'unknown', active: true,
      addresses: [address('192.0.2.10')] },
    { id: 'Mihomo', name: 'Mihomo', kind: 'virtual', active: true,
      addresses: [address('198.18.0.1')] },
  ];
  const run = (command, args) => {
    const call = args.join(' ');
    if (command === 'curl.exe') return JSON.stringify({ mode: 'direct', 'mixed-port': 7897,
      tun: { enable: true } });
    if (call.includes('Get-NetAdapter')) return JSON.stringify({ adapters: [
      { InterfaceAlias: 'Ethernet 2', InterfaceIndex: 7, Status: 'Up', HardwareInterface: true },
      { InterfaceAlias: 'Mihomo', InterfaceIndex: 22, Status: 'Up', HardwareInterface: false },
    ], routes: [
      { InterfaceIndex: 22, RouteMetric: 0, InterfaceMetric: 1 },
      { InterfaceIndex: 7, RouteMetric: 0, InterfaceMetric: 25 },
    ], proxy: { enabled: true, server: 'http=127.0.0.1:7897;https=127.0.0.1:7897' },
    processes: { ProcessId: 91, Name: 'mihomo.exe',
      CommandLine: 'mihomo.exe --external-controller 127.0.0.1:9090' } });
    return '';
  };
  const result = await detectWindows({ interfaces, run });
  const physical = result.interfaces.find(({ name }) => name === 'Ethernet 2');
  const virtual = result.interfaces.find(({ name }) => name === 'Mihomo');
  assert.equal(physical.id, 'if:7');
  assert.equal(physical.default, true);
  assert.equal(virtual.systemDefault, true);
  assert.equal(virtual.kind, 'virtual');
  assert.equal(result.systemProxy.owner.mode, 'direct');
});

test('public projection is bounded and resolves only usable addresses', () => {
  const projected = projectNetworkEnvironment({ platform: 'linux', status: 'ready', interfaces: [
    { id: 'eth0', name: 'Ethernet', kind: 'physical', active: true, default: true,
      systemDefault: true, secret: 'discard', addresses: [address('192.0.2.5'), address('169.254.1.2')] },
  ], systemProxy: { state: 'unknown', owner: { token: 'discard' } } }, '169.254.1.2');
  assert.equal(projected.interfaces[0].secret, undefined);
  assert.equal(projected.systemProxy.owner.token, undefined);
  assert.equal(projected.selection.available, false);
  assert.equal(projected.defaultRoute.sourceAddress, '192.0.2.5');
  assert.equal(usableSourceAddress('192.0.2.5'), true);
  assert.equal(usableSourceAddress('fe80::1'), false);
});

test('Mihomo mode is not confirmed unless its advertised listener owns the system proxy port', async () => {
  const owner = await mihomoOwner({ platform: 'linux', endpoint: { host: '127.0.0.1', port: 7890 },
    processes: [{ executable: '/usr/bin/mihomo', args: 'mihomo --external-controller 127.0.0.1:9090' }],
    run: () => JSON.stringify({ mode: 'global', 'mixed-port': 8888, tun: { enable: true } }) });
  assert.equal(owner.confidence, 'observed');
  assert.equal(owner.mode, 'unknown');
  assert.equal(owner.tunEnabled, null);
});

test('service emits paired Engine underlay arguments for default and explicit selections', async () => {
  let detections = 0;
  const service = new NetworkEnvironmentService({ platform: 'linux', now: () => 100,
    networkInterfaces: () => ({ eth0: [address('192.0.2.20')], tun0: [address('100.64.0.8')] }),
    run: (_command, args) => {
      if (args.includes('route')) { detections += 1; return JSON.stringify([
        { dst: 'default', dev: 'tun0', metric: 1 }, { dst: 'default', dev: 'eth0', metric: 20 },
      ]); }
      return '';
    }, environment: {} });
  await service.refresh();
  assert.deepEqual(service.engineArguments(''), ['--source-interface', 'eth0',
    '--source-address', '192.0.2.20']);
  assert.deepEqual(service.engineArguments('100.64.0.8'), ['--source-interface', 'tun0',
    '--source-address', '100.64.0.8']);
  assert.equal(service.engineArguments('192.0.2.99'), null);
  assert.equal(detections, 1, 'the bounded cache avoids repeated platform probes');
});

test('service single-flights concurrent platform refreshes', async () => {
  let routeCalls = 0;
  let releaseRoute;
  const routeResult = new Promise((resolve) => { releaseRoute = resolve; });
  const service = new NetworkEnvironmentService({
    platform: 'linux',
    networkInterfaces: () => ({ eth0: [address('192.0.2.20')] }),
    run: async (_command, args) => {
      if (args.includes('route')) { routeCalls += 1; return routeResult; }
      return '';
    },
    environment: {},
  });
  const first = service.snapshot();
  const second = service.snapshot();
  await Promise.resolve();
  assert.equal(routeCalls, 1);
  releaseRoute(JSON.stringify([{ dst: 'default', dev: 'eth0', metric: 10 }]));
  const [left, right] = await Promise.all([first, second]);
  assert.deepEqual(left, right);
  assert.equal(left.defaultRoute.interfaceId, 'eth0');
});
