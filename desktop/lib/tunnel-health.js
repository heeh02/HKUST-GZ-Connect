'use strict';

// Recovery from a lost tunnel means killing and restarting the engine, which
// drops every request the campus browser has in flight. A tunnel that is merely
// congested — a page pulling dozens of subresources through one gateway session
// — must therefore never be mistaken for a dead one:
//
//   * the probe deadline is longer than a heavy page load, so a late answer
//     still counts as alive;
//   * probing is infrequent, so the probe does not add its own load while a
//     page is loading;
//   * several consecutive failures are required, so recovery needs roughly a
//     minute of a completely unresponsive tunnel.
const TELEMETRY_TICK_MS = 2500;
const PROBE_INTERVAL_TICKS = 8;
const PROBE_TIMEOUT_MS = 12000;
const FAILURES_BEFORE_RECOVERY = 3;

function shouldProbe(tick) {
  return Number.isInteger(tick) && tick % PROBE_INTERVAL_TICKS === 0;
}

function recoveryEvidenceWindowMs() {
  return TELEMETRY_TICK_MS * PROBE_INTERVAL_TICKS * FAILURES_BEFORE_RECOVERY;
}

function shouldRecover({ failures, autoReconnect } = {}) {
  if (autoReconnect === false) return false;
  return Number.isInteger(failures) && failures >= FAILURES_BEFORE_RECOVERY;
}

module.exports = {
  FAILURES_BEFORE_RECOVERY,
  PROBE_INTERVAL_TICKS,
  PROBE_TIMEOUT_MS,
  TELEMETRY_TICK_MS,
  recoveryEvidenceWindowMs,
  shouldProbe,
  shouldRecover,
};
