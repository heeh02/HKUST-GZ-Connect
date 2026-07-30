'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { STABLE_SESSION_MS, planReconnect } = require('../lib/reconnect-policy');

test('a short-lived listener does not reset the retry budget', () => {
  assert.deepEqual(planReconnect({
    attempts: 2,
    maxAttempts: 3,
    wasConnected: true,
    uptimeMs: 1000,
    failureKind: 'gateway-transient',
  }), { attempt: 3, delayMs: 15_000 });
  assert.equal(planReconnect({
    attempts: 3,
    maxAttempts: 3,
    wasConnected: true,
    uptimeMs: 1000,
  }), null);
});

test('a genuinely stable session receives a fresh retry budget', () => {
  assert.deepEqual(planReconnect({
    attempts: 3,
    maxAttempts: 3,
    wasConnected: true,
    uptimeMs: STABLE_SESSION_MS + 1,
  }), { attempt: 1, delayMs: 2000 });
});

test('gateway transients settle longer than ordinary failures', () => {
  assert.equal(planReconnect({
    attempts: 0,
    maxAttempts: 3,
    failureKind: 'gateway-transient',
  }).delayMs, 5000);
  assert.equal(planReconnect({
    attempts: 0,
    maxAttempts: 3,
    failureKind: 'unknown',
  }).delayMs, 2000);
});
