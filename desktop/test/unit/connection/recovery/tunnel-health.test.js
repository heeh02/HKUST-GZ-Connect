'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FAILURES_BEFORE_RECOVERY,
  PROBE_INTERVAL_TICKS,
  PROBE_TIMEOUT_MS,
  TELEMETRY_TICK_MS,
  recoveryEvidenceWindowMs,
  shouldProbe,
  shouldRecover,
} = require('../../../../lib/connection/recovery/tunnel-health');

test('a slow tunnel is given enough time to answer the liveness probe', () => {
  // A congested tunnel still answers, just late. A probe deadline near the
  // duration of a heavy page load reports a working tunnel as dead.
  assert.ok(PROBE_TIMEOUT_MS >= 10000, `probe deadline too tight: ${PROBE_TIMEOUT_MS}ms`);
});

test('the engine is only restarted after a sustained loss of the tunnel', () => {
  // Restarting tears down every in-flight page load, so it must require far
  // more evidence than one slow moment.
  assert.ok(
    recoveryEvidenceWindowMs() >= 60000,
    `recovery window too short: ${recoveryEvidenceWindowMs()}ms`,
  );
  assert.ok(FAILURES_BEFORE_RECOVERY >= 3);
});

test('probing does not compete with the tunnel on every telemetry tick', () => {
  const probes = [];
  for (let tick = 0; tick < PROBE_INTERVAL_TICKS * 2; tick += 1) {
    if (shouldProbe(tick)) probes.push(tick);
  }
  assert.deepEqual(probes, [0, PROBE_INTERVAL_TICKS]);
});

test('recovery respects the auto-reconnect setting and the failure budget', () => {
  assert.equal(shouldRecover({ failures: FAILURES_BEFORE_RECOVERY, autoReconnect: true }), true);
  assert.equal(shouldRecover({ failures: FAILURES_BEFORE_RECOVERY - 1, autoReconnect: true }), false);
  assert.equal(shouldRecover({ failures: FAILURES_BEFORE_RECOVERY, autoReconnect: false }), false);
  assert.equal(shouldRecover({ failures: 99, autoReconnect: false }), false);
  // An absent setting means the default, which is enabled.
  assert.equal(shouldRecover({ failures: FAILURES_BEFORE_RECOVERY }), true);
});

test('the telemetry tick stays responsive for the live counters', () => {
  assert.ok(TELEMETRY_TICK_MS <= 3000);
});

test('a probe outlives a telemetry tick, so it must never be awaited in the pump', () => {
  // Two sequential probe deadlines can exceed the tick by an order of magnitude.
  // Awaiting them inside the telemetry pump would hold its busy flag and freeze
  // the live counters for the whole probe.
  assert.ok(
    PROBE_TIMEOUT_MS > TELEMETRY_TICK_MS,
    'a probe that fits inside one tick would not need to run detached',
  );
});
