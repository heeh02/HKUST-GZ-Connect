'use strict';

// Control v2 gets the first bounded window so the Rust engine can close its
// listener and complete best-effort logout without relying on OS signals.
const STOP_CONTROL_GRACE_MS = 6_000;
// SIGTERM remains the compatibility path for an older or unhealthy engine.
const STOP_GRACE_MS = 6_000;
const STOP_FORCE_WAIT_MS = 2_000;

function stopPhase(elapsedMs, { withControl = false } = {}) {
  if (withControl && elapsedMs < STOP_CONTROL_GRACE_MS) return 'control';
  const signalElapsedMs = elapsedMs - (withControl ? STOP_CONTROL_GRACE_MS : 0);
  if (signalElapsedMs < STOP_GRACE_MS) return 'grace';
  if (signalElapsedMs < STOP_GRACE_MS + STOP_FORCE_WAIT_MS) return 'force';
  return 'failed';
}

module.exports = {
  STOP_CONTROL_GRACE_MS,
  STOP_GRACE_MS,
  STOP_FORCE_WAIT_MS,
  stopPhase,
};
