'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_NETWORK_POLL_MS,
  NetworkStatusMonitor,
} = require('../lib/network-status-monitor');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

class FakeTimer {
  constructor() {
    this.unrefCount = 0;
  }

  unref() {
    this.unrefCount += 1;
  }
}

class FakeTimers {
  constructor() {
    this.nextId = 1;
    this.active = new Map();
    this.all = new Map();
  }

  setTimeout(callback, delayMs) {
    const id = this.nextId++;
    const record = { callback, delayMs, timer: new FakeTimer() };
    this.active.set(id, record);
    this.all.set(id, record);
    return record.timer;
  }

  clearTimeout(timer) {
    for (const [id, record] of this.active) {
      if (record.timer === timer) this.active.delete(id);
    }
  }

  ids() {
    return [...this.active.keys()];
  }

  record(id) {
    return this.all.get(id);
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

function monitorFor(statuses, overrides = {}) {
  const timers = new FakeTimers();
  const events = [];
  let reads = 0;
  const monitor = new NetworkStatusMonitor({
    isOnline: () => {
      const value = statuses[Math.min(reads, statuses.length - 1)];
      reads += 1;
      if (value instanceof Error) throw value;
      return value;
    },
    onOnline: () => events.push('online'),
    onOffline: () => events.push('offline'),
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
    ...overrides,
  });
  return { events, get reads() { return reads; }, monitor, timers };
}

async function fireOnlyTimer(fixture) {
  const [id] = fixture.timers.ids();
  assert.ok(id, 'expected one scheduled poll');
  await fixture.timers.fire(id);
  return id;
}

test('start establishes a silent baseline and only real transitions emit', async () => {
  const fixture = monitorFor([true, true, false, false, true]);
  assert.equal(await fixture.monitor.start(), true);
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.monitor.snapshot().baseline, true);

  await fireOnlyTimer(fixture);
  assert.deepEqual(fixture.events, []);
  await fireOnlyTimer(fixture);
  assert.deepEqual(fixture.events, ['offline']);
  await fireOnlyTimer(fixture);
  assert.deepEqual(fixture.events, ['offline']);
  await fireOnlyTimer(fixture);
  assert.deepEqual(fixture.events, ['offline', 'online']);
});

test('sync errors and non-boolean samples are ignored without changing the baseline', async () => {
  const fixture = monitorFor([new Error('net unavailable'), 'yes', false, undefined, true]);
  await fixture.monitor.start();
  assert.equal(fixture.monitor.snapshot().baseline, null);
  await fireOnlyTimer(fixture);
  assert.equal(fixture.monitor.snapshot().baseline, null);
  await fireOnlyTimer(fixture);
  assert.equal(fixture.monitor.snapshot().baseline, false);
  assert.deepEqual(fixture.events, []);
  await fireOnlyTimer(fixture);
  assert.equal(fixture.monitor.snapshot().baseline, false);
  await fireOnlyTimer(fixture);
  assert.deepEqual(fixture.events, ['online']);
});

test('every recursive timer uses the reviewed default interval and is unrefed', async () => {
  const fixture = monitorFor([true, true]);
  await fixture.monitor.start();
  const [first] = fixture.timers.ids();
  assert.equal(fixture.timers.record(first).delayMs, DEFAULT_NETWORK_POLL_MS);
  assert.equal(fixture.timers.record(first).timer.unrefCount, 1);
  await fixture.timers.fire(first);
  const [second] = fixture.timers.ids();
  assert.equal(fixture.timers.record(second).timer.unrefCount, 1);
});

test('stop makes an already queued timer callback inert', async () => {
  const fixture = monitorFor([true, false]);
  await fixture.monitor.start();
  const [timer] = fixture.timers.ids();
  const queued = fixture.timers.callback(timer);
  fixture.monitor.stop();

  assert.deepEqual(fixture.timers.ids(), []);
  assert.equal(await queued(), undefined);
  assert.equal(fixture.reads, 1);
  assert.deepEqual(fixture.events, []);
  assert.deepEqual(fixture.monitor.snapshot(), {
    running: false,
    disposed: false,
    baseline: null,
    pollInFlight: false,
    timerScheduled: false,
  });
});

test('stop or dispose invalidates an asynchronous result already in flight', async () => {
  for (const action of ['stop', 'dispose']) {
    const timers = new FakeTimers();
    const second = deferred();
    let reads = 0;
    const events = [];
    const monitor = new NetworkStatusMonitor({
      isOnline: () => (++reads === 1 ? true : second.promise),
      onOnline: () => events.push('online'),
      onOffline: () => events.push('offline'),
      setTimeout: timers.setTimeout.bind(timers),
      clearTimeout: timers.clearTimeout.bind(timers),
    });
    await monitor.start();
    const [timer] = timers.ids();
    const poll = timers.fire(timer);
    await Promise.resolve();
    monitor[action]();
    second.resolve(false);
    assert.equal(await poll, false);
    assert.deepEqual(events, []);
    assert.deepEqual(timers.ids(), []);
  }
});

test('an async poll never overlaps and repeated start is idempotent', async () => {
  const timers = new FakeTimers();
  const pending = deferred();
  let activeReads = 0;
  let maxActiveReads = 0;
  let reads = 0;
  const monitor = new NetworkStatusMonitor({
    isOnline: async () => {
      reads += 1;
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      try { return reads === 1 ? true : await pending.promise; }
      finally { activeReads -= 1; }
    },
    onOnline() {},
    onOffline() {},
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
  });
  await monitor.start();
  const [timer] = timers.ids();
  const queuedTick = timers.callback(timer);
  const inFlight = timers.fire(timer);
  await Promise.resolve();
  assert.equal(reads, 2);
  assert.equal(await queuedTick(), undefined, 'the same queued tick cannot start a second poll');
  assert.equal(monitor.snapshot().pollInFlight, true);
  assert.deepEqual(timers.ids(), [], 'next poll is scheduled only after completion');
  const repeatedStart = monitor.start();
  assert.equal(reads, 2);
  pending.resolve(false);
  assert.equal(await inFlight, true);
  assert.equal(await repeatedStart, true);
  assert.equal(maxActiveReads, 1);
  assert.equal(reads, 2);
  assert.equal(timers.ids().length, 1);
});

test('restart after stop learns a new baseline without emitting a transition', async () => {
  const fixture = monitorFor([true, false]);
  await fixture.monitor.start();
  const [oldTimer] = fixture.timers.ids();
  const staleTick = fixture.timers.callback(oldTimer);
  fixture.monitor.stop();
  await fixture.monitor.start();
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.monitor.snapshot().baseline, false);
  assert.equal(await staleTick(), undefined);
  assert.equal(fixture.reads, 2, 'an old stopped tick cannot read into the restarted monitor');
});

test('constructor bounds the polling interval and dispose prevents restart', async () => {
  assert.throws(() => new NetworkStatusMonitor(), /callbacks/);
  assert.throws(() => monitorFor([true], { intervalMs: 999 }), /interval/);
  const fixture = monitorFor([true]);
  fixture.monitor.dispose();
  assert.equal(await fixture.monitor.start(), false);
  assert.equal(fixture.reads, 0);
});
