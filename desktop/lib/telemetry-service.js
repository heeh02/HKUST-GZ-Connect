'use strict';

const VISIBLE_PUMP_MS = 2_500;
const HIDDEN_PUMP_MS = 10_000;
const VISIBLE_APP_REFRESH_MS = 7_500;
const VISIBLE_LATENCY_REFRESH_MS = 5_000;
const HIDDEN_LATENCY_REFRESH_MS = 30_000;
const VISIBLE_HEALTH_REFRESH_MS = 10_000;
const HIDDEN_HEALTH_REFRESH_MS = 30_000;

class TelemetryService {
  constructor({
    collectApps,
    collectLatency,
    collectHealth,
    emit,
    isVisible,
    isGenerationCurrent,
    onError,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    now = Date.now,
  } = {}) {
    this.collectApps = collectApps;
    this.collectLatency = collectLatency;
    this.collectHealth = collectHealth;
    this.emit = emit;
    this.isVisible = typeof isVisible === 'function' ? isVisible : () => true;
    this.isGenerationCurrent = isGenerationCurrent;
    this.onError = typeof onError === 'function' ? onError : null;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.now = now;
    this.timer = null;
    this.runId = 0;
    this.generation = null;
    this.busy = null;
    this.lastAppsAt = -Infinity;
    this.lastLatencyAt = -Infinity;
    this.lastHealthAt = -Infinity;
    this.snapshot = this.emptySnapshot();
    this.lastError = null;
  }

  emptySnapshot() {
    return {
      connCount: 0,
      apps: [],
      latencyMs: null,
      tunnelHealth: 'unknown',
      failedHealthTargets: [],
    };
  }

  current(runId, generation) {
    return runId === this.runId && generation === this.generation &&
      (typeof this.isGenerationCurrent !== 'function' || this.isGenerationCurrent(generation));
  }

  start(generation) {
    this.stop();
    this.generation = generation;
    const runId = this.runId;
    this.launchPump(runId, generation);
  }

  launchPump(runId, generation) {
    Promise.resolve().then(() => this.pump(runId, generation)).catch((error) => {
      this.lastError = error;
      if (this.onError) {
        try { this.onError(error, generation); } catch {}
      }
    });
  }

  schedule(runId, generation, visible) {
    if (!this.current(runId, generation)) return;
    if (this.timer) this.clearTimeoutFn(this.timer);
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      this.launchPump(runId, generation);
    }, visible ? VISIBLE_PUMP_MS : HIDDEN_PUMP_MS);
    this.timer?.unref?.();
  }

  async pump(runId, generation) {
    if (!this.current(runId, generation)) return;
    const visible = Boolean(this.isVisible());
    if (this.busy) {
      this.schedule(runId, generation, visible);
      return;
    }
    const busyRecord = { runId, generation };
    this.busy = busyRecord;
    const timestamp = this.now();
    try {
      // Process enumeration is a user-facing control-tower feature. Stop it
      // entirely while the window is hidden instead of polling from the tray.
      if (visible && typeof this.collectApps === 'function' &&
          timestamp - this.lastAppsAt >= VISIBLE_APP_REFRESH_MS) {
        const apps = await this.collectApps(generation);
        if (!this.current(runId, generation)) return;
        this.snapshot.connCount = Math.max(0, Number(apps?.connCount) || 0);
        this.snapshot.apps = Array.isArray(apps?.apps) ? apps.apps : [];
        this.lastAppsAt = timestamp;
      }

      const latencyInterval = visible ? VISIBLE_LATENCY_REFRESH_MS : HIDDEN_LATENCY_REFRESH_MS;
      if (typeof this.collectLatency === 'function' &&
          timestamp - this.lastLatencyAt >= latencyInterval) {
        const latency = await this.collectLatency(generation);
        if (!this.current(runId, generation)) return;
        this.snapshot.latencyMs = Number.isFinite(latency) ? latency : null;
        this.lastLatencyAt = timestamp;
      }

      const healthInterval = visible ? VISIBLE_HEALTH_REFRESH_MS : HIDDEN_HEALTH_REFRESH_MS;
      if (typeof this.collectHealth === 'function' &&
          timestamp - this.lastHealthAt >= healthInterval) {
        const health = await this.collectHealth(generation);
        if (!this.current(runId, generation)) return;
        if (health && typeof health.kind === 'string') {
          this.snapshot.tunnelHealth = health.kind;
          this.snapshot.failedHealthTargets = Array.isArray(health.failedTargets)
            ? health.failedTargets.slice(0, 8)
            : [];
        }
        this.lastHealthAt = timestamp;
      }

      if (this.current(runId, generation) && typeof this.emit === 'function') {
        this.emit({ ...this.snapshot, apps: [...this.snapshot.apps] }, generation);
      }
    } finally {
      if (this.busy === busyRecord) this.busy = null;
      this.schedule(runId, generation, Boolean(this.isVisible()));
    }
  }

  stop() {
    this.runId += 1;
    this.generation = null;
    if (this.timer) this.clearTimeoutFn(this.timer);
    this.timer = null;
    this.busy = null;
    this.lastAppsAt = -Infinity;
    this.lastLatencyAt = -Infinity;
    this.lastHealthAt = -Infinity;
    this.snapshot = this.emptySnapshot();
    this.lastError = null;
  }
}

module.exports = {
  HIDDEN_HEALTH_REFRESH_MS,
  HIDDEN_LATENCY_REFRESH_MS,
  HIDDEN_PUMP_MS,
  TelemetryService,
  VISIBLE_APP_REFRESH_MS,
  VISIBLE_HEALTH_REFRESH_MS,
  VISIBLE_LATENCY_REFRESH_MS,
  VISIBLE_PUMP_MS,
};
