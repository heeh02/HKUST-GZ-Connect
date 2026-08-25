'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ConnectionWaitRegistry,
  MAX_PENDING_CONNECTION_INTENTS,
} = require('../../../../lib/connection/state/connection-wait-registry');

class FakeTimer {
  constructor(callback, delayMs) {
    this.callback = callback;
    this.delayMs = delayMs;
    this.unrefCount = 0;
  }

  unref() { this.unrefCount += 1; }
}

class FakeTimers {
  constructor() { this.active = new Set(); }

  setTimeout(callback, delayMs) {
    const timer = new FakeTimer(callback, delayMs);
    this.active.add(timer);
    return timer;
  }

  clearTimeout(timer) { this.active.delete(timer); }

  fire(timer) {
    if (!this.active.delete(timer)) return undefined;
    return timer.callback();
  }
}

function snapshot(intent, phase, desiredConnected = true) {
  return { intent, phase, desiredConnected };
}

test('only the exact observed intent can satisfy a connection waiter', async () => {
  const registry = new ConnectionWaitRegistry();
  registry.observe(snapshot(4, 'starting'));
  const old = registry.wait(4, { timeoutMs: 1000 });
  registry.observe(snapshot(5, 'connected'));
  assert.equal(await old, false, 'a newer connection cannot satisfy an old request');
  assert.equal(await registry.wait(5, { timeoutMs: 1000 }), true);
});

test('disconnect and terminal failure resolve immediately while retry progress remains pending', async () => {
  const registry = new ConnectionWaitRegistry();
  registry.observe(snapshot(7, 'starting'));
  const retrying = registry.wait(7, { timeoutMs: 1000 });
  registry.observe(snapshot(7, 'retry-wait'));
  let settled = false;
  retrying.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  registry.observe(snapshot(7, 'idle', false));
  assert.equal(await retrying, false);

  registry.observe(snapshot(8, 'starting'));
  const disconnected = registry.wait(8, { timeoutMs: 1000 });
  registry.observe(snapshot(9, 'stopping', false));
  assert.equal(await disconnected, false);
});

test('each waiter owns one deadline timer and timeout resolves false', async () => {
  const timers = new FakeTimers();
  const registry = new ConnectionWaitRegistry({
    setTimeoutFn: timers.setTimeout.bind(timers),
    clearTimeoutFn: timers.clearTimeout.bind(timers),
  });
  registry.observe(snapshot(11, 'authenticating'));
  const waiting = registry.wait(11, { timeoutMs: 3210 });
  assert.equal(timers.active.size, 1);
  const [timer] = timers.active;
  assert.equal(timer.delayMs, 3210);
  assert.equal(timer.unrefCount, 1);
  timers.fire(timer);
  assert.equal(await waiting, false);
  assert.equal(timers.active.size, 0);
});

test('dispose clears every timer and makes current and future waits false', async () => {
  const timers = new FakeTimers();
  const registry = new ConnectionWaitRegistry({
    setTimeoutFn: timers.setTimeout.bind(timers),
    clearTimeoutFn: timers.clearTimeout.bind(timers),
  });
  registry.observe(snapshot(13, 'preparing-tunnel'));
  const first = registry.wait(13, { timeoutMs: 1000 });
  const second = registry.wait(13, { timeoutMs: 1000 });
  assert.equal(first, second, 'same-intent callers share one outcome promise');
  assert.equal(timers.active.size, 1, 'same-intent callers share one deadline timer');
  registry.dispose();
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(timers.active.size, 0);
  assert.equal(await registry.wait(13, { timeoutMs: 1000 }), false);
});

test('pending intent capacity fails the next waiter closed and dispose clears every timer', async () => {
  const timers = new FakeTimers();
  const registry = new ConnectionWaitRegistry({
    setTimeoutFn: timers.setTimeout.bind(timers),
    clearTimeoutFn: timers.clearTimeout.bind(timers),
  });
  const pending = Array.from({ length: MAX_PENDING_CONNECTION_INTENTS }, (_, index) => (
    registry.wait(index + 1, { timeoutMs: 1000 })
  ));
  assert.equal(timers.active.size, MAX_PENDING_CONNECTION_INTENTS);
  assert.equal(await registry.wait(MAX_PENDING_CONNECTION_INTENTS + 1, { timeoutMs: 1000 }), false);
  assert.equal(timers.active.size, MAX_PENDING_CONNECTION_INTENTS);
  registry.dispose();
  assert.deepEqual(await Promise.all(pending), Array(MAX_PENDING_CONNECTION_INTENTS).fill(false));
  assert.equal(timers.active.size, 0);
});
