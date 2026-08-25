'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ConnectivityRecovery,
  RECOVERY_DEBOUNCE_MS,
} = require('../../../../lib/connection/recovery/connectivity-recovery');

class FakeTimers {
  constructor() {
    this.nextId = 1;
    this.active = new Map();
    this.all = new Map();
  }

  setTimeout(callback, delayMs) {
    const id = this.nextId++;
    const record = { callback, delayMs };
    this.active.set(id, record);
    this.all.set(id, record);
    return id;
  }

  clearTimeout(id) {
    this.active.delete(id);
  }

  ids() {
    return [...this.active.keys()];
  }

  callback(id) {
    return this.all.get(id)?.callback;
  }

  fire(id) {
    const record = this.active.get(id);
    if (!record) return undefined;
    this.active.delete(id);
    return record.callback();
  }
}

function harness(overrides = {}) {
  const timers = new FakeTimers();
  const state = {
    intent: 1,
    wantsConnection: true,
    invalidations: [],
    checks: [],
    reconnects: [],
  };
  const recovery = new ConnectivityRecovery({
    invalidate: (reason, intent) => state.invalidations.push([reason, intent]),
    getLifecycleIntent: () => state.intent,
    shouldReconnect: async (intent) => {
      state.checks.push(intent);
      return state.wantsConnection && intent === state.intent;
    },
    reconnect: async (intent, reason) => { state.reconnects.push([intent, reason]); },
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
    ...overrides,
  });
  return { recovery, state, timers };
}

test('suspend invalidates immediately and resume debounces one recovery', async () => {
  const { recovery, state, timers } = harness();
  assert.equal(recovery.suspend(), true);
  assert.deepEqual(state.invalidations, [['suspend', 1]]);
  assert.deepEqual(recovery.snapshot(), {
    suspended: true,
    offline: false,
    pending: true,
    pendingIntent: 1,
    recoveryInFlight: false,
    timerScheduled: false,
  });

  assert.equal(recovery.resume(), true);
  const [timer] = timers.ids();
  assert.equal(timers.all.get(timer).delayMs, RECOVERY_DEBOUNCE_MS);
  assert.deepEqual(state.reconnects, []);
  assert.equal(await timers.fire(timer), true);
  assert.deepEqual(state.checks, [1]);
  assert.deepEqual(state.reconnects, [[1, 'resume']]);
  assert.equal(recovery.snapshot().pending, false);
  assert.equal(recovery.resume(), false, 'the consumed outage cannot reconnect twice');
});

test('offline/online flapping is merged and a cleared old timer is harmless', async () => {
  const { recovery, state, timers } = harness();
  recovery.networkOffline();
  recovery.networkOnline();
  const [firstTimer] = timers.ids();
  const staleCallback = timers.callback(firstTimer);

  recovery.networkOffline();
  assert.deepEqual(timers.ids(), []);
  assert.deepEqual(state.invalidations, [['network-offline', 1]]);
  recovery.networkOnline();
  const [secondTimer] = timers.ids();
  recovery.networkOnline();
  assert.deepEqual(timers.ids(), [secondTimer], 'duplicate online events share one debounce');

  assert.equal(await staleCallback(), undefined);
  assert.deepEqual(state.reconnects, []);
  assert.equal(await timers.fire(secondTimer), true);
  assert.deepEqual(state.reconnects, [[1, 'network-online']]);
  assert.deepEqual(state.invalidations, [['network-offline', 1]]);

  recovery.networkOffline();
  assert.deepEqual(state.invalidations, [
    ['network-offline', 1],
    ['network-offline', 1],
  ], 'a later independent outage invalidates the recovered tunnel again');
});

test('resume waits until both suspension and offline state have cleared', async () => {
  const { recovery, state, timers } = harness();
  recovery.suspend();
  recovery.networkOffline();
  assert.equal(recovery.resume(), false);
  assert.deepEqual(timers.ids(), []);
  assert.equal(recovery.networkOnline(), true);
  const [timer] = timers.ids();
  assert.equal(await timers.fire(timer), true);
  assert.deepEqual(state.reconnects, [[1, 'network-online']]);
  assert.deepEqual(state.invalidations, [['suspend', 1]]);
});

test('a timer captured for an old lifecycle intent cannot touch a new connection', async () => {
  const { recovery, state, timers } = harness();
  recovery.networkOffline();
  recovery.networkOnline();
  const [timer] = timers.ids();

  state.intent = 2;
  assert.equal(await timers.fire(timer), false);
  assert.deepEqual(state.checks, []);
  assert.deepEqual(state.reconnects, []);
  assert.equal(recovery.snapshot().pending, false);
  assert.equal(recovery.networkOffline(1), false, 'a stale explicit event cannot invalidate intent 2');
  assert.deepEqual(state.invalidations, [['network-offline', 1]]);
});

test('explicit disconnect or quit intent never auto-recovers', async () => {
  const { recovery, state, timers } = harness();
  recovery.suspend();
  recovery.resume();
  const [timer] = timers.ids();
  state.wantsConnection = false;
  assert.equal(await timers.fire(timer), false);
  assert.deepEqual(state.checks, [1]);
  assert.deepEqual(state.reconnects, []);

  state.wantsConnection = true;
  state.intent = 2;
  recovery.networkOffline();
  recovery.networkOnline();
  const [cancelledTimer] = timers.ids();
  const staleCallback = timers.callback(cancelledTimer);
  recovery.cancel();
  assert.deepEqual(timers.ids(), []);
  assert.equal(await staleCallback(), undefined);
  assert.deepEqual(state.reconnects, []);
});

test('a current ordinary recovery rejected by policy is explicitly settled', async () => {
  const declined = [];
  const { recovery, timers } = harness({
    shouldReconnect: async () => false,
    onRecoveryDeclined: (intent, reason) => declined.push([intent, reason]),
  });
  recovery.suspend();
  recovery.resume();
  const [timer] = timers.ids();
  assert.equal(await timers.fire(timer), false);
  assert.deepEqual(declined, [[1, 'resume']]);
  assert.equal(recovery.snapshot().pending, false);
});

test('stale or cancelled recovery never settles a replacement intent', async () => {
  const declined = [];
  const { recovery, state, timers } = harness({
    shouldReconnect: async () => false,
    onRecoveryDeclined: (intent, reason) => declined.push([intent, reason]),
  });
  recovery.networkOffline();
  recovery.networkOnline();
  const [timer] = timers.ids();
  state.intent = 2;
  assert.equal(await timers.fire(timer), false);
  assert.deepEqual(declined, []);
});

test('an availability change while shouldReconnect is pending invalidates its decision', async () => {
  const timers = new FakeTimers();
  let resolveDecision;
  const decision = new Promise((resolve) => { resolveDecision = resolve; });
  const reconnects = [];
  const recovery = new ConnectivityRecovery({
    invalidate: () => {},
    getLifecycleIntent: () => 4,
    shouldReconnect: () => decision,
    reconnect: async (...args) => { reconnects.push(args); },
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
    debounceMs: 10,
  });
  recovery.networkOffline();
  recovery.networkOnline();
  const [timer] = timers.ids();
  const attempt = timers.fire(timer);
  recovery.networkOffline();
  resolveDecision(true);

  assert.equal(await attempt, false);
  assert.deepEqual(reconnects, []);
  assert.equal(recovery.snapshot().pending, true, 'the newer outage remains pending');
});

test('dispose permanently suppresses later power and network events', () => {
  const { recovery, state, timers } = harness();
  recovery.suspend();
  recovery.resume();
  recovery.dispose();
  assert.deepEqual(timers.ids(), []);
  assert.equal(recovery.resume(), false);
  assert.equal(recovery.networkOnline(), false);
  assert.equal(recovery.suspend(), false);
  assert.equal(recovery.networkOffline(), false);
  assert.deepEqual(state.reconnects, []);
});

test('constructor rejects incomplete or unsafe scheduler contracts', () => {
  assert.throws(() => new ConnectivityRecovery(), /callbacks/);
  assert.throws(() => new ConnectivityRecovery({
    invalidate() {},
    getLifecycleIntent() { return 1; },
    shouldReconnect() { return true; },
    reconnect() {},
    debounceMs: -1,
  }), /debounce/);
});

test('initial network availability carries one startup-only recovery reason', async () => {
  const timers = new FakeTimers();
  const checks = [];
  const reconnects = [];
  const recovery = new ConnectivityRecovery({
    invalidate() {},
    getLifecycleIntent: () => 9,
    shouldReconnect: async (intent, reason) => {
      checks.push([intent, reason]);
      return reason === 'initial-network-online';
    },
    reconnect: async (intent, reason) => { reconnects.push([intent, reason]); },
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
    debounceMs: 10,
  });

  recovery.networkOffline(9);
  assert.equal(recovery.initialNetworkOnline(9), true);
  const [startupTimer] = timers.ids();
  assert.equal(await timers.fire(startupTimer), true);
  assert.deepEqual(checks, [[9, 'initial-network-online']]);
  assert.deepEqual(reconnects, [[9, 'initial-network-online']]);

  recovery.networkOffline(9);
  assert.equal(recovery.networkOnline(9), true);
  const [ordinaryTimer] = timers.ids();
  assert.equal(await timers.fire(ordinaryTimer), false);
  assert.deepEqual(checks.at(-1), [9, 'network-online']);
  assert.deepEqual(reconnects, [[9, 'initial-network-online']],
    'the startup bypass must not enable later automatic reconnect');
});

test('startup-only recovery reason survives an overlapping suspend until resume', async () => {
  const timers = new FakeTimers();
  const reconnects = [];
  const recovery = new ConnectivityRecovery({
    invalidate() {},
    getLifecycleIntent: () => 12,
    shouldReconnect: async (_intent, reason) => reason === 'initial-network-online',
    reconnect: async (intent, reason) => { reconnects.push([intent, reason]); },
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
    debounceMs: 10,
  });
  recovery.networkOffline(12);
  recovery.suspend(12);
  assert.equal(recovery.initialNetworkOnline(12), false,
    'network availability alone cannot resume while the machine is suspended');
  assert.equal(recovery.resume(12), true);
  const [timer] = timers.ids();
  assert.equal(await timers.fire(timer), true);
  assert.deepEqual(reconnects, [[12, 'initial-network-online']]);
});
