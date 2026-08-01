'use strict';

// The Rust engine may spend up to its HTTP timeout completing best-effort
// logout after SIGTERM. Give that path time to finish before escalating.
const STOP_GRACE_MS = 15_000;
const STOP_FORCE_WAIT_MS = 2_000;

function stopPhase(elapsedMs) {
  if (elapsedMs < STOP_GRACE_MS) return 'grace';
  if (elapsedMs < STOP_GRACE_MS + STOP_FORCE_WAIT_MS) return 'force';
  return 'failed';
}

module.exports = { STOP_GRACE_MS, STOP_FORCE_WAIT_MS, stopPhase };
