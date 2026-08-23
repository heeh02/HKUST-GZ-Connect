'use strict';

const DEFAULT_CONNECTION_WAIT_MS = 45_000;
const MAX_CONNECTION_WAIT_MS = 10 * 60 * 1000;
const MAX_PENDING_CONNECTION_INTENTS = 32;

function validIntent(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizedSnapshot(value) {
  if (!value || !validIntent(value.intent) || typeof value.phase !== 'string' ||
      typeof value.desiredConnected !== 'boolean') return null;
  return Object.freeze({
    intent: value.intent,
    phase: value.phase,
    desiredConnected: value.desiredConnected,
  });
}

function outcomeFor(intent, snapshot) {
  if (!snapshot) return null;
  if (snapshot.intent !== intent) return false;
  if (snapshot.phase === 'connected') return true;
  if (!snapshot.desiredConnected) return false;
  return null;
}

class ConnectionWaitRegistry {
  constructor({ setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
    if (typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
      throw new TypeError('connection wait timer dependencies are invalid');
    }
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.latest = null;
    this.waiters = new Map();
    this.disposed = false;
  }

  observe(value) {
    if (this.disposed) return false;
    const snapshot = normalizedSnapshot(value);
    if (!snapshot) return false;
    if (this.latest && snapshot.intent < this.latest.intent) return false;
    this.latest = snapshot;
    for (const waiter of [...this.waiters.values()]) {
      const outcome = outcomeFor(waiter.intent, snapshot);
      if (outcome !== null) this.settle(waiter, outcome);
    }
    return true;
  }

  wait(intent, { timeoutMs = DEFAULT_CONNECTION_WAIT_MS } = {}) {
    if (!validIntent(intent) || !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
        timeoutMs > MAX_CONNECTION_WAIT_MS) {
      return Promise.resolve(false);
    }
    if (this.disposed) return Promise.resolve(false);
    const immediate = outcomeFor(intent, this.latest);
    if (immediate !== null) return Promise.resolve(immediate);
    const existing = this.waiters.get(intent);
    if (existing) return existing.promise;
    if (this.waiters.size >= MAX_PENDING_CONNECTION_INTENTS) return Promise.resolve(false);

    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const waiter = { intent, resolve, promise, timer: null, settled: false };
    this.waiters.set(intent, waiter);
    const timer = this.setTimeoutFn(() => this.settle(waiter, false), timeoutMs);
    if (waiter.settled) {
      try { this.clearTimeoutFn(timer); } catch {}
      return promise;
    }
    waiter.timer = timer;
    waiter.timer?.unref?.();
    const outcome = outcomeFor(intent, this.latest);
    if (outcome !== null) this.settle(waiter, outcome);
    return promise;
  }

  settle(waiter, outcome) {
    if (!waiter || waiter.settled || this.waiters.get(waiter.intent) !== waiter) return false;
    waiter.settled = true;
    this.waiters.delete(waiter.intent);
    try { this.clearTimeoutFn(waiter.timer); } catch {}
    waiter.timer = null;
    waiter.resolve(outcome === true);
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.latest = null;
    for (const waiter of [...this.waiters.values()]) this.settle(waiter, false);
  }

  snapshot() {
    return Object.freeze({ disposed: this.disposed, waiters: this.waiters.size });
  }
}

module.exports = {
  ConnectionWaitRegistry,
  DEFAULT_CONNECTION_WAIT_MS,
  MAX_CONNECTION_WAIT_MS,
  MAX_PENDING_CONNECTION_INTENTS,
  normalizedSnapshot,
  outcomeFor,
};
