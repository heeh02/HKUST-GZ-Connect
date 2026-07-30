'use strict';

const STABLE_SESSION_MS = 20_000;
const MAX_DELAY_MS = 15_000;

function planReconnect({
  attempts = 0,
  maxAttempts = 0,
  wasConnected = false,
  uptimeMs = 0,
  failureKind = 'unknown',
} = {}) {
  const usedAttempts = wasConnected && uptimeMs > STABLE_SESSION_MS ? 0 : attempts;
  if (usedAttempts >= maxAttempts) return null;

  const attempt = usedAttempts + 1;
  const delayStep = failureKind === 'gateway-transient' ? 5000 : 2000;
  return {
    attempt,
    delayMs: Math.min(delayStep * attempt, MAX_DELAY_MS),
  };
}

module.exports = { MAX_DELAY_MS, STABLE_SESSION_MS, planReconnect };
