'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ConnectionTelemetryCoordinator } = require('../lib/connection-telemetry-coordinator');

class FakeTelemetryService {
  constructor(options) { this.options = options; this.starts = []; this.stops = 0; }
  start(generation) { this.starts.push(generation); }
  stop() { this.stops += 1; }
}

function fixture(overrides = {}) {
  const calls = [];
  let health = { kind: 'healthy', failedTargets: [] };
  const coordinator = new ConnectionTelemetryCoordinator({
    appPid: 10,
    gatewayHost: 'gateway.example.test',
    getSocksPort: () => 6180,
    getEnginePid: () => 20,
    getProxyCredentials: () => null,
    isConnected: () => true,
    isEngineCurrent: () => true,
    isVisible: () => true,
    getConnectedAt: () => 100,
    send: (snapshot) => calls.push(['send', snapshot]),
    getAutoReconnect: () => true,
    isDesiredConnected: () => true,
    reconnect: async (generation) => calls.push(['reconnect', generation]),
    onRecovering: () => calls.push(['recovering']),
    enumerator: { list: async () => ({ connCount: 0, apps: [] }) },
    runHealthRound: async () => health,
    probe: async () => true,
    ping: async () => 5,
    TelemetryServiceClass: FakeTelemetryService,
    ...overrides,
  });
  return { calls, coordinator, setHealth(value) { health = value; } };
}

test('start/stop bind all telemetry to one current Engine generation', () => {
  const f = fixture();
  f.coordinator.start(7);
  assert.equal(f.coordinator.current(7), true);
  assert.deepEqual(f.coordinator.service.starts, [7]);
  f.coordinator.service.options.emit({
    connCount: 1,
    apps: [],
    failedHealthTargetCount: 2,
    failedHealthTargets: ['internal-health.school.example'],
    tunnelHealth: 'internal-health.school.example',
    privateProfileState: true,
  }, 7);
  assert.equal(f.calls[0][1].connectedAt, 100);
  assert.equal(f.calls[0][1].failedHealthTargetCount, 2);
  assert.equal(f.calls[0][1].tunnelHealth, 'unknown');
  assert.equal('failedHealthTargets' in f.calls[0][1], false);
  assert.equal('privateProfileState' in f.calls[0][1], false);
  f.coordinator.stop();
  assert.equal(f.coordinator.current(7), false);
});

test('profile Gateway port and health targets drive telemetry without global defaults', async () => {
  const calls = [];
  const targets = [
    { host: 'one.example.test', port: 444 },
    { host: 'two.example.test', port: 445 },
  ];
  const f = fixture({
    gatewayPort: 8443,
    healthTargets: targets,
    ping: async (host, port) => { calls.push(['ping', host, port]); return 7; },
    runHealthRound: async (options) => {
      calls.push(['health', options.targets]);
      return { kind: 'healthy', failedTargets: [] };
    },
  });
  f.coordinator.start(7);
  await f.coordinator.service.options.collectLatency();
  await f.coordinator.checkHealth(7);
  assert.deepEqual(calls, [
    ['ping', 'gateway.example.test', 8443],
    ['health', targets],
  ]);
});

test('healthy evidence resets failures while three total failures trigger one reconnect', async () => {
  const f = fixture();
  f.coordinator.start(7);
  f.setHealth({ kind: 'failed', failedTargets: ['a', 'b'] });
  await f.coordinator.checkHealth(7);
  await f.coordinator.checkHealth(7);
  assert.equal(f.calls.some(([name]) => name === 'reconnect'), false);
  await f.coordinator.checkHealth(7);
  assert.deepEqual(f.calls.filter(([name]) => name === 'recovering' || name === 'reconnect'), [
    ['recovering'], ['reconnect', 7],
  ]);
  assert.equal(f.coordinator.probeFailures, 0);
  f.setHealth({ kind: 'healthy', failedTargets: [] });
  await f.coordinator.checkHealth(7);
  assert.equal(f.coordinator.probeFailures, 0);
});

test('disabled recovery and stale generations never restart the Engine', async () => {
  const disabled = fixture({ getAutoReconnect: () => false });
  disabled.coordinator.start(7);
  disabled.setHealth({ kind: 'failed', failedTargets: [] });
  await disabled.coordinator.checkHealth(7);
  await disabled.coordinator.checkHealth(7);
  await disabled.coordinator.checkHealth(7);
  assert.equal(disabled.calls.length, 0);

  const stale = fixture({ isEngineCurrent: () => false });
  stale.coordinator.start(7);
  assert.equal(await stale.coordinator.checkHealth(7), undefined);
});
