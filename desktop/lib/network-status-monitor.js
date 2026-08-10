'use strict';

const DEFAULT_NETWORK_POLL_MS = 4000;
const MIN_NETWORK_POLL_MS = 1000;
const MAX_NETWORK_POLL_MS = 60_000;

class NetworkStatusMonitor {
  constructor({
    isOnline,
    onOnline,
    onOffline,
    setTimeout: setTimer = globalThis.setTimeout,
    clearTimeout: clearTimer = globalThis.clearTimeout,
    intervalMs = DEFAULT_NETWORK_POLL_MS,
  } = {}) {
    if (typeof isOnline !== 'function' || typeof onOnline !== 'function' ||
        typeof onOffline !== 'function' || typeof setTimer !== 'function' ||
        typeof clearTimer !== 'function') {
      throw new TypeError('network status monitor callbacks are required');
    }
    if (!Number.isFinite(intervalMs) || intervalMs < MIN_NETWORK_POLL_MS ||
        intervalMs > MAX_NETWORK_POLL_MS) {
      throw new TypeError('network status monitor interval is out of range');
    }
    this.isOnline = isOnline;
    this.onOnline = onOnline;
    this.onOffline = onOffline;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.intervalMs = intervalMs;

    this.running = false;
    this.disposed = false;
    this.epoch = 0;
    this.baseline = null;
    this.timerRecord = null;
    this.pollRecord = null;
  }

  isCurrent(epoch) {
    return this.running && !this.disposed && epoch === this.epoch;
  }

  start() {
    if (this.disposed) return Promise.resolve(false);
    if (this.running) {
      return this.pollRecord ? this.pollRecord.promise : Promise.resolve(true);
    }
    this.running = true;
    this.epoch += 1;
    this.baseline = null;
    return this.poll(this.epoch);
  }

  poll(epoch) {
    if (!this.isCurrent(epoch)) return Promise.resolve(false);
    if (this.pollRecord && this.pollRecord.epoch === epoch) return this.pollRecord.promise;

    const record = { epoch, promise: null };
    record.promise = (async () => {
      let observed;
      try {
        // The Promise boundary catches both a synchronous net.isOnline throw
        // and a test/backend that exposes an asynchronous status provider.
        observed = await Promise.resolve().then(() => this.isOnline());
      } catch {
        observed = undefined;
      }
      if (!this.isCurrent(epoch)) return false;

      if (typeof observed === 'boolean') {
        if (this.baseline === null) {
          // Startup learns the current state without synthesizing an event.
          this.baseline = observed;
        } else if (observed !== this.baseline) {
          this.baseline = observed;
          try {
            await (observed ? this.onOnline() : this.onOffline());
          } catch {}
        }
      }
      return true;
    })().finally(() => {
      if (this.pollRecord === record) this.pollRecord = null;
      if (this.isCurrent(epoch)) this.schedule(epoch);
    });
    this.pollRecord = record;
    return record.promise;
  }

  schedule(epoch) {
    if (!this.isCurrent(epoch) || this.timerRecord) return false;
    const record = { epoch, timer: null };
    record.timer = this.setTimer(() => {
      if (this.timerRecord !== record || !this.isCurrent(epoch)) return undefined;
      this.timerRecord = null;
      return this.poll(epoch);
    }, this.intervalMs);
    if (record.timer && typeof record.timer.unref === 'function') record.timer.unref();
    this.timerRecord = record;
    return true;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.epoch += 1;
    this.baseline = null;
    if (this.timerRecord) {
      try { this.clearTimer(this.timerRecord.timer); } catch {}
      this.timerRecord = null;
    }
    // An asynchronous poll is intentionally not cancelled; its epoch check
    // makes the result inert, and its finally block cannot schedule again.
    this.pollRecord = null;
  }

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
  }

  snapshot() {
    return {
      running: this.running,
      disposed: this.disposed,
      baseline: this.baseline,
      pollInFlight: this.pollRecord !== null,
      timerScheduled: this.timerRecord !== null,
    };
  }
}

module.exports = {
  DEFAULT_NETWORK_POLL_MS,
  MAX_NETWORK_POLL_MS,
  MIN_NETWORK_POLL_MS,
  NetworkStatusMonitor,
};
