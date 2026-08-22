'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { EngineConnectionRuntime } = require('../lib/engine-connection-runtime');

class FakeControl {
  constructor() {
    this.handshakes = 0;
    this.chunks = [];
  }
  handshake() { this.handshakes += 1; return Promise.resolve(); }
  feed(chunk) { this.chunks.push(Buffer.from(chunk)); }
}

function fixture(overrides = {}) {
  const control = new FakeControl();
  const binds = [];
  const calls = [];
  const diagnostics = [];
  let timerCallback;
  let clearedTimer = null;
  const handlers = Object.fromEntries([
    'onConnecting',
    'onStopping',
    'onConnectionCandidate',
    'onListenerReady',
    'onListenerMismatch',
    'onClientIpAssigned',
    'onDnsMode',
    'onNetworkUnhealthy',
    'onFatalError',
    'onStopped',
    'onProtocolTimeout',
  ].map((name) => [name, (...args) => calls.push([name, ...args])]));
  const runtime = new EngineConnectionRuntime({
    generation: 7,
    expectedPort: 6180,
    stdin: { write() {} },
    controlRegistry: {
      bind(generation, stdin) {
        binds.push([generation, stdin]);
        return control;
      },
    },
    isCurrent: () => true,
    handlers: { ...handlers, onDiagnostic: (event) => diagnostics.push(event) },
    setTimeoutFn: (callback, delay) => {
      timerCallback = callback;
      return { delay, unref() {} };
    },
    clearTimeoutFn: (timer) => { clearedTimer = timer; },
    ...overrides,
  });
  return {
    binds,
    calls,
    control,
    diagnostics,
    get clearedTimer() { return clearedTimer; },
    runtime,
    stdout: new EventEmitter(),
    get timerCallback() { return timerCallback; },
  };
}

function lines(...events) {
  return Buffer.from(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
}

test('runtime binds one generation, negotiates before readiness, and dispatches typed events', async () => {
  const f = fixture();
  assert.equal(f.binds.length, 1);
  assert.equal(f.runtime.start(f.stdout), true);
  assert.equal(f.runtime.start(f.stdout), false);
  assert.equal(f.control.handshakes, 1);
  f.stdout.emit('data', lines(
    { type: 'hello', apiVersion: 1, capabilities: ['password', 'l3'] },
    { type: 'state_changed', state: 'authenticating', generation: 7 },
    { type: 'state_changed', state: 'preparing_tunnel', generation: 7 },
    { type: 'state_changed', state: 'connected', generation: 7 },
    { type: 'listener_ready', port: 6180 },
    { type: 'client_ip_assigned', family: 4 },
    { type: 'dns_mode', mode: 'gateway' },
    { type: 'network_unhealthy', reason: 'data_plane_disconnected' },
    { type: 'state_changed', state: 'stopping', generation: 7 },
    { type: 'fatal_error', code: 'AUTH_FAILED' },
    { type: 'stopped', reason: 'startup_failed', generation: 7 },
  ));
  assert.equal(f.runtime.helloSeen, true);
  assert.equal(f.runtime.stoppedReason, 'startup_failed');
  assert.deepEqual(f.diagnostics.map((event) => event.type), [
    'hello',
    'state_changed',
    'state_changed',
    'state_changed',
    'listener_ready',
    'client_ip_assigned',
    'dns_mode',
    'network_unhealthy',
    'state_changed',
    'fatal_error',
    'stopped',
  ]);
  assert.deepEqual(f.calls, [
    ['onConnecting', 'authenticating'],
    ['onConnecting', 'preparing_tunnel'],
    ['onConnectionCandidate'],
    ['onListenerReady'],
    ['onClientIpAssigned', 4],
    ['onDnsMode', 'gateway'],
    ['onNetworkUnhealthy', 'data_plane_disconnected'],
    ['onStopping'],
    ['onFatalError', 'AUTH_FAILED', null],
    ['onStopped', 'startup_failed'],
  ]);
  assert.equal(f.control.chunks.length, 1, 'v2/v3 control sees the same stdout chunk');
  assert.ok(f.clearedTimer, 'the Event API hello clears its deadline');
});

test('listener mismatch and stale generation output fail closed before UI callbacks', () => {
  let current = true;
  const f = fixture({ isCurrent: () => current });
  f.runtime.start(f.stdout);
  f.stdout.emit('data', lines(
    { type: 'hello', apiVersion: 1, capabilities: [] },
    { type: 'listener_ready', port: 7000 },
  ));
  assert.deepEqual(f.calls, [['onListenerMismatch', 7000, 6180]]);
  current = false;
  f.stdout.emit('data', lines({ type: 'fatal_error', code: 'AUTH_FAILED' }));
  assert.equal(f.calls.length, 1);
  assert.equal(f.control.chunks.length, 1, 'stale bytes do not reach either parser');
});

test('hello timeout is generation-aware and dispose removes the stream listener', () => {
  const f = fixture();
  f.runtime.start(f.stdout);
  f.timerCallback();
  assert.deepEqual(f.calls, [['onProtocolTimeout']]);
  assert.equal(f.runtime.dispose(), true);
  assert.equal(f.runtime.dispose(), false);
  assert.equal(f.stdout.listenerCount('data'), 0);

  const stale = fixture({ isCurrent: () => false });
  stale.runtime.start(stale.stdout);
  stale.timerCallback();
  assert.deepEqual(stale.calls, []);
});

test('exit drain rejects buffered readiness but preserves terminal outcome until close', () => {
  const f = fixture();
  f.runtime.start(f.stdout);
  f.stdout.emit('data', lines(
    { type: 'hello', apiVersion: 1, capabilities: [] },
    { type: 'state_changed', state: 'authenticating', generation: 7 },
  ));
  assert.deepEqual(f.calls, [['onConnecting', 'authenticating']]);
  assert.equal(f.runtime.beginExitDrain(), true);
  assert.equal(f.runtime.beginExitDrain(), false);
  f.stdout.emit('data', lines(
    { type: 'listener_ready', port: 6180 },
    { type: 'state_changed', state: 'connected', generation: 7 },
    { type: 'fatal_error', code: 'NETWORK_DISCONNECTED' },
    { type: 'stopped', reason: 'network_unhealthy', generation: 7 },
  ));
  assert.deepEqual(f.calls, [
    ['onConnecting', 'authenticating'],
    ['onFatalError', 'NETWORK_DISCONNECTED', null],
    ['onStopped', 'network_unhealthy'],
  ]);
  assert.equal(f.runtime.stoppedReason, 'network_unhealthy');
  assert.deepEqual(f.diagnostics.slice(-2).map((event) => event.type), [
    'fatal_error', 'stopped',
  ]);
  assert.equal(f.stdout.listenerCount('data'), 1, 'terminal drain remains attached through close');
  assert.equal(f.runtime.dispose(), true);
  assert.equal(f.stdout.listenerCount('data'), 0);
});

test('constructor rejects unbound generations, ports, controls and handlers', () => {
  assert.throws(() => new EngineConnectionRuntime(), /generation/);
  assert.throws(() => new EngineConnectionRuntime({
    generation: 1,
    expectedPort: 80,
    controlRegistry: { bind() {} },
    isCurrent() {},
  }), /port/);
  assert.throws(() => new EngineConnectionRuntime({
    generation: 1,
    expectedPort: 6180,
    controlRegistry: {},
    isCurrent() {},
  }), /registry/);
});
