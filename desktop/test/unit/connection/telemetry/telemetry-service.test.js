'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  HIDDEN_PUMP_MS,
  TelemetryService,
  VISIBLE_PUMP_MS,
} = require('../../../../lib/connection/telemetry/telemetry-service');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('visible telemetry collects app usage but hidden telemetry stops process enumeration', async () => {
  let visible = true;
  let now = 0;
  let appsCalls = 0;
  const timers = [];
  const emissions = [];
  const service = new TelemetryService({
    collectApps: async () => { appsCalls += 1; return { connCount: 2, apps: [{ name: 'SSH' }] }; },
    collectLatency: async () => 12,
    collectHealth: async () => ({
      kind: 'site-failure',
      failedTargets: ['internal-health.school.example'],
    }),
    emit: (snapshot) => emissions.push(snapshot),
    isVisible: () => visible,
    isGenerationCurrent: (generation) => generation === 7,
    now: () => now,
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: () => {},
  });
  service.start(7);
  await flush();
  assert.equal(appsCalls, 1);
  assert.equal(emissions.at(-1).connCount, 2);
  assert.equal(emissions.at(-1).failedHealthTargetCount, 1);
  assert.equal('failedHealthTargets' in emissions.at(-1), false);
  assert.equal(JSON.stringify(emissions.at(-1)).includes('internal-health.school.example'), false);
  assert.equal(timers.at(-1).delay, VISIBLE_PUMP_MS);

  visible = false;
  now = 40_000;
  timers.at(-1).callback();
  await flush();
  assert.equal(appsCalls, 1, 'hidden window must not enumerate processes');
  assert.equal(timers.at(-1).delay, HIDDEN_PUMP_MS);
  service.stop();
});

test('stopping invalidates an in-flight collector before it can emit stale state', async () => {
  let resolveApps;
  const emissions = [];
  const service = new TelemetryService({
    collectApps: () => new Promise((resolve) => { resolveApps = resolve; }),
    collectLatency: async () => null,
    collectHealth: async () => ({ kind: 'healthy', failedTargets: [] }),
    emit: (snapshot) => emissions.push(snapshot),
    isVisible: () => true,
    isGenerationCurrent: () => true,
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn: () => {},
  });
  service.start(3);
  await flush();
  service.stop();
  resolveApps({ connCount: 99, apps: [{ name: 'stale' }] });
  await flush();
  assert.deepEqual(emissions, []);
});

test('a slow health probe never blocks latency pumps or their retry timer', async () => {
  let now = 0;
  let resolveHealth;
  let healthCalls = 0;
  let latencyCalls = 0;
  const timers = [];
  const emissions = [];
  const service = new TelemetryService({
    collectApps: async () => ({ connCount: 0, apps: [] }),
    collectLatency: async () => { latencyCalls += 1; return 7; },
    collectHealth: () => {
      healthCalls += 1;
      return new Promise((resolve) => { resolveHealth = resolve; });
    },
    emit: (snapshot) => emissions.push(snapshot),
    isVisible: () => true,
    isGenerationCurrent: () => true,
    now: () => now,
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: () => {},
  });
  service.start(4);
  await flush();
  assert.equal(healthCalls, 1);
  assert.equal(latencyCalls, 1);
  assert.equal(timers.length, 1, 'the normal pump schedules while health remains pending');

  now = VISIBLE_PUMP_MS;
  timers[0].callback();
  await flush();
  assert.equal(healthCalls, 1, 'an in-flight health round is single-flight');
  assert.equal(timers.length, 2, 'a second pump schedules without awaiting health');

  resolveHealth({ kind: 'healthy', failedTargets: [] });
  await flush();
  assert.equal(emissions.at(-1).tunnelHealth, 'healthy');
  service.stop();
});

test('collector failures are reported without becoming unhandled rejections', async () => {
  const failure = new Error('telemetry unavailable');
  const reported = [];
  const timers = [];
  const service = new TelemetryService({
    collectApps: async () => { throw failure; },
    emit: () => {},
    isVisible: () => true,
    isGenerationCurrent: (generation) => generation === 9,
    onError: (error, generation) => reported.push({ error, generation }),
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: () => {},
  });

  service.start(9);
  await flush();
  await flush();

  assert.deepEqual(reported, [{ error: failure, generation: 9 }]);
  assert.equal(service.lastError, failure);
  assert.equal(timers.length, 1, 'a failed sample must retain the bounded retry schedule');
  service.stop();
});
