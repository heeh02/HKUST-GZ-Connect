'use strict';

// Repeatable desktop-idle baseline. It deliberately uses a virtual clock and
// synthetic collectors: no process enumerator, browser, gateway, credential,
// existing application userData, or application log is opened by this script.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  HIDDEN_HEALTH_REFRESH_MS,
  HIDDEN_LATENCY_REFRESH_MS,
  HIDDEN_PUMP_MS,
  TelemetryService,
} = require('../lib/connection/telemetry/telemetry-service');
const {
  PERFORMANCE_REPORT_SCHEMA,
  writePerformanceReport,
} = require('./performance-report');
const { scheduleTemporaryProfileCleanup } = require('./temp-profile-cleanup');

const SIMULATED_IDLE_MS = 60_000;
const CPU_OBSERVATION_MS = 250;
const CPU_PRODUCT_TARGET_MS_PER_SECOND = 25;
const HARD_TIMEOUT_MS = 10_000;

let electronProfile = null;
let electronRuntime = null;
if (process.versions.electron) {
  electronRuntime = require('electron');
  const { app } = electronRuntime;
  electronProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-idle-baseline-'));
  scheduleTemporaryProfileCleanup(electronProfile, 'hkustgz-idle-baseline');
  app.setPath('userData', electronProfile);
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function virtualScheduler() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  const scheduledDelays = [];

  return {
    now: () => now,
    setTimeout(callback, delay) {
      const timer = { id: nextId, callback, delay, unref() {} };
      nextId += 1;
      pending.set(timer.id, timer);
      scheduledDelays.push(delay);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) pending.delete(timer.id);
    },
    async advanceOne() {
      const timer = pending.values().next().value;
      if (!timer) throw new Error('virtual telemetry timer is missing');
      pending.delete(timer.id);
      now += timer.delay;
      timer.callback();
      await flushMicrotasks();
    },
    pendingCount: () => pending.size,
    scheduledDelays,
  };
}

async function measureHiddenTelemetryIdle({
  simulatedIdleMs = SIMULATED_IDLE_MS,
  isVisible = () => false,
} = {}) {
  if (!Number.isSafeInteger(simulatedIdleMs) || simulatedIdleMs < HIDDEN_PUMP_MS ||
      simulatedIdleMs % HIDDEN_PUMP_MS !== 0) {
    throw new TypeError('simulated idle duration must be a positive hidden-pump multiple');
  }
  const scheduler = virtualScheduler();
  const calls = { apps: 0, latency: 0, health: 0, emissions: 0 };
  const service = new TelemetryService({
    collectApps: async () => {
      calls.apps += 1;
      return { connCount: 0, apps: [] };
    },
    collectLatency: async () => { calls.latency += 1; return null; },
    collectHealth: async () => {
      calls.health += 1;
      return { kind: 'unknown', failedTargets: [] };
    },
    emit: () => { calls.emissions += 1; },
    isVisible,
    isGenerationCurrent: (generation) => generation === 1,
    now: scheduler.now,
    setTimeoutFn: scheduler.setTimeout,
    clearTimeoutFn: scheduler.clearTimeout,
  });

  service.start(1);
  await flushMicrotasks();
  while (scheduler.now() < simulatedIdleMs) await scheduler.advanceOne();

  const pendingBeforeStop = scheduler.pendingCount();
  service.stop();
  const minimumDelay = Math.min(...scheduler.scheduledDelays);
  const maximumDelay = Math.max(...scheduler.scheduledDelays);
  const expectedSlowSamples = 1 + Math.floor(simulatedIdleMs / HIDDEN_LATENCY_REFRESH_MS);

  assert.equal(calls.apps, 0, 'hidden telemetry must not enumerate applications');
  assert.equal(calls.latency, expectedSlowSamples, 'hidden latency sampling cadence changed');
  assert.equal(calls.health, 1 + Math.floor(simulatedIdleMs / HIDDEN_HEALTH_REFRESH_MS),
    'hidden health sampling cadence changed');
  assert.equal(minimumDelay, HIDDEN_PUMP_MS, 'hidden telemetry scheduled a faster pump');
  assert.equal(maximumDelay, HIDDEN_PUMP_MS, 'hidden telemetry scheduled an unexpected pump');
  assert.equal(pendingBeforeStop, 1, 'hidden telemetry must own exactly one pending timer');
  assert.equal(scheduler.pendingCount(), 0, 'stop must cancel the hidden telemetry timer');

  return {
    simulatedIdleMs,
    pumpRuns: calls.emissions,
    applicationEnumerationCalls: calls.apps,
    latencySamples: calls.latency,
    healthSamples: calls.health,
    scheduledTimers: scheduler.scheduledDelays.length,
    minimumTimerMs: minimumDelay,
    maximumTimerMs: maximumDelay,
    pendingTimersBeforeStop: pendingBeforeStop,
    pendingTimersAfterStop: scheduler.pendingCount(),
  };
}

async function observeIdleProcessCpu({
  durationMs = CPU_OBSERVATION_MS,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  cpuUsage = process.cpuUsage,
  monotonicNow = process.hrtime.bigint,
} = {}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new TypeError('CPU observation duration must be positive');
  }
  const startedAt = monotonicNow();
  const startedCpu = cpuUsage();
  await delay(durationMs);
  const elapsedNanoseconds = monotonicNow() - startedAt;
  const used = cpuUsage(startedCpu);
  const wallMilliseconds = Number(elapsedNanoseconds) / 1_000_000;
  const cpuMilliseconds = (Number(used.user) + Number(used.system)) / 1_000;
  return {
    observationMs: Math.round(wallMilliseconds * 100) / 100,
    cpuMs: Math.round(cpuMilliseconds * 100) / 100,
    cpuMsPerWallSecond: Math.round((cpuMilliseconds * 1_000 / wallMilliseconds) * 100) / 100,
    productTargetMsPerSecond: CPU_PRODUCT_TARGET_MS_PER_SECOND,
    productTargetMet: cpuMilliseconds * 1_000 / wallMilliseconds <=
      CPU_PRODUCT_TARGET_MS_PER_SECOND,
    enforced: false,
  };
}

async function buildIdlePerformanceReport(options = {}) {
  const hiddenTelemetry = await measureHiddenTelemetryIdle(options);
  const cpuObservation = await observeIdleProcessCpu(options);
  return {
    schema: PERFORMANCE_REPORT_SCHEMA,
    kind: 'desktop_hidden_idle',
    scope: {
      network: 'none',
      clock: 'virtual_for_telemetry',
      inputs: 'synthetic',
      runtime: process.versions.electron ? 'electron_main' : 'node_test_harness',
      hiddenWindow: options.hiddenWindow === true,
      gatewayPerformanceMeasured: false,
    },
    hiddenTelemetry,
    cpuObservation,
    guard: {
      class: 'offline_contract_guard',
      passed: true,
      applicationEnumerationCallsMaximum: 0,
      minimumHiddenPumpMs: HIDDEN_PUMP_MS,
      minimumHiddenLatencyRefreshMs: HIDDEN_LATENCY_REFRESH_MS,
      minimumHiddenHealthRefreshMs: HIDDEN_HEALTH_REFRESH_MS,
    },
    interpretation: {
      cpuIsObservationOnly: true,
      productTargetIsNotReleaseGate: true,
      realDeviceBaselineRequired: true,
    },
  };
}

async function main() {
  let electronApp = null;
  let hiddenWindow = null;
  try {
    if (process.versions.electron) {
      const electron = electronRuntime;
      electronApp = electron.app;
      await electronApp.whenReady();
      hiddenWindow = new electron.BrowserWindow({
        show: false,
        width: 320,
        height: 240,
        webPreferences: {
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      await hiddenWindow.loadURL('data:text/html,<meta charset=utf-8><title>idle baseline</title>');
      assert.equal(hiddenWindow.isVisible(), false, 'idle baseline window must remain hidden');
    }
    writePerformanceReport(await buildIdlePerformanceReport({
      hiddenWindow: hiddenWindow !== null,
      isVisible: () => hiddenWindow?.isVisible() === true,
    }));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    if (hiddenWindow && !hiddenWindow.isDestroyed()) hiddenWindow.destroy();
    if (electronApp) {
      try { await electronRuntime.session.defaultSession.clearStorageData(); } catch {}
      try { electronRuntime.session.defaultSession.flushStorageData(); } catch {}
      fs.rmSync(electronProfile, { recursive: true, force: true });
    }
  }
  electronApp?.exit(0);
}

if (require.main === module || process.versions.electron) {
  const hardTimeout = setTimeout(() => {
    process.stderr.write(`desktop idle baseline exceeded ${HARD_TIMEOUT_MS}ms hard timeout\n`);
    if (process.versions.electron) electronRuntime.app.exit(1);
    else process.exit(1);
  }, HARD_TIMEOUT_MS);
  main().then(
    () => clearTimeout(hardTimeout),
    (error) => {
      clearTimeout(hardTimeout);
      process.stderr.write(`desktop idle baseline failed: ${error?.message || 'unknown error'}\n`);
      if (process.versions.electron) electronRuntime.app.exit(1);
      else process.exitCode = 1;
    },
  );
}

module.exports = {
  CPU_OBSERVATION_MS,
  CPU_PRODUCT_TARGET_MS_PER_SECOND,
  HARD_TIMEOUT_MS,
  SIMULATED_IDLE_MS,
  buildIdlePerformanceReport,
  measureHiddenTelemetryIdle,
  observeIdleProcessCpu,
};
