'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runConcurrentHealthRound } = require('../lib/health-supervisor');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const targets = [
  { host: 'one.example', port: 443 },
  { host: 'two.example', port: 443 },
];

test('both health targets start concurrently and a single-site outage is classified separately', async () => {
  const gates = new Map(targets.map((target) => [target.host, deferred()]));
  const started = [];
  const round = runConcurrentHealthRound({
    generation: 7,
    isGenerationCurrent: (generation) => generation === 7,
    probe: ({ targetHost }) => {
      started.push(targetHost);
      return gates.get(targetHost).promise;
    },
    proxyPort: 6180,
    targets,
    timeoutMs: 1000,
  });

  await Promise.resolve();
  assert.deepEqual(started, ['one.example', 'two.example']);
  gates.get('one.example').resolve(true);
  gates.get('two.example').resolve(false);
  const result = await round;
  assert.equal(result.kind, 'site-failure');
  assert.deepEqual(result.succeededTargets, ['one.example']);
  assert.deepEqual(result.failedTargets, ['two.example']);
});

test('a probe result from an invalidated generation is stale and cannot recover a new tunnel', async () => {
  const gates = targets.map(() => deferred());
  let currentGeneration = 12;
  let probeIndex = 0;
  const round = runConcurrentHealthRound({
    generation: 12,
    isGenerationCurrent: (generation) => generation === currentGeneration,
    probe: () => gates[probeIndex++].promise,
    proxyPort: 6180,
    targets,
    timeoutMs: 1000,
  });

  currentGeneration = 13;
  gates.forEach((gate) => gate.resolve(false));
  const result = await round;
  assert.deepEqual(result, {
    kind: 'stale',
    generation: 12,
    succeededTargets: [],
    failedTargets: [],
  });
});

test('all probes share one overall deadline instead of sequential deadlines', async () => {
  const started = [];
  const deadlineCallbacks = [];
  const clearedTimers = [];
  const timer = { unref() {} };
  const round = runConcurrentHealthRound({
    generation: 3,
    isGenerationCurrent: (generation) => generation === 3,
    probe: ({ targetHost, timeoutMs }) => {
      started.push([targetHost, timeoutMs]);
      return new Promise(() => {});
    },
    proxyPort: 6180,
    targets,
    timeoutMs: 12000,
    setTimeoutFn: (callback) => {
      deadlineCallbacks.push(callback);
      return timer;
    },
    clearTimeoutFn: (candidate) => clearedTimers.push(candidate),
  });

  await Promise.resolve();
  assert.deepEqual(started, [
    ['one.example', 12000],
    ['two.example', 12000],
  ]);
  assert.equal(deadlineCallbacks.length, 1, 'the round must own one shared deadline');
  deadlineCallbacks[0]();
  const result = await round;
  assert.equal(result.kind, 'tunnel-failure');
  assert.equal(result.deadlineExpired, true);
  assert.deepEqual(result.failedTargets, ['one.example', 'two.example']);
  assert.deepEqual(clearedTimers, [timer]);
});

test('a synchronous exception from one target does not prevent the other probe', async () => {
  const started = [];
  const result = await runConcurrentHealthRound({
    generation: 9,
    isGenerationCurrent: () => true,
    probe: ({ targetHost }) => {
      started.push(targetHost);
      if (targetHost === 'one.example') throw new Error('bad target');
      return true;
    },
    proxyPort: 6180,
    targets,
    timeoutMs: 1000,
  });
  assert.deepEqual(started, ['one.example', 'two.example']);
  assert.equal(result.kind, 'site-failure');
  assert.deepEqual(result.failedTargets, ['one.example']);
});

test('a completed success remains site evidence when the other target hits the shared deadline', async () => {
  let expire;
  const round = runConcurrentHealthRound({
    generation: 8,
    isGenerationCurrent: () => true,
    probe: ({ targetHost }) => (
      targetHost === 'one.example' ? Promise.resolve(true) : new Promise(() => {})
    ),
    proxyPort: 6180,
    targets,
    timeoutMs: 12000,
    setTimeoutFn: (callback) => {
      expire = callback;
      return { unref() {} };
    },
    clearTimeoutFn: () => {},
  });
  // Let the already-successful target publish its result before expiring the
  // independently controlled overall deadline.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expire();
  const result = await round;
  assert.equal(result.kind, 'site-failure');
  assert.deepEqual(result.succeededTargets, ['one.example']);
  assert.deepEqual(result.failedTargets, ['two.example']);
});

test('two successful targets prove the tunnel healthy', async () => {
  const proxyCredentials = { username: Buffer.from('u'), password: Buffer.from('p') };
  const observedCredentials = [];
  const result = await runConcurrentHealthRound({
    generation: 4,
    isGenerationCurrent: () => true,
    probe: async ({ proxyCredentials: received }) => {
      observedCredentials.push(received);
      return true;
    },
    proxyPort: 6180,
    proxyCredentials,
    targets,
    timeoutMs: 1000,
  });
  assert.equal(result.kind, 'healthy');
  assert.deepEqual(result.failedTargets, []);
  assert.deepEqual(observedCredentials, [proxyCredentials, proxyCredentials]);
});
