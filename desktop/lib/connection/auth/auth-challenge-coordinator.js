'use strict';

const MAX_AUTH_RESPONSE_BYTES = 4096;
const MAX_TIMER_DELAY_MS = 0x7fff_ffff;
const PUBLIC_ERROR_CODES = new Set([
  'invalid_request',
  'stale_context',
  'duplicate_request',
  'unsupported_challenge',
  'resend_unavailable',
  'challenge_expired',
  'limit_exceeded',
  'provider_failure',
  'transaction_closed',
]);

function rendererChallengeView(challenge) {
  return Object.freeze({
    kind: challenge.kind,
    deliveryChannel: challenge.deliveryChannel,
    maskedDestination: challenge.maskedDestination,
    expiresAtUnixMs: challenge.expiresAtUnixMs,
    resendAvailable: challenge.resendAvailable,
    resendAfterUnixMs: challenge.resendAfterUnixMs,
    attemptsRemaining: challenge.attemptsRemaining,
  });
}

class AuthChallengeCoordinator {
  constructor({ publish = () => {}, now = Date.now, setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout, isContextCurrent = () => true } = {}) {
    if (typeof isContextCurrent !== 'function') {
      throw new TypeError('authentication context guard is required');
    }
    this.publish = publish;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.isContextCurrent = isContextCurrent;
    this.binding = null;
    this.publicView = null;
    this.expiryTimer = null;
    this.inFlight = false;
  }

  bind(generation, control, contextToken) {
    if (!Number.isSafeInteger(generation) || generation <= 0 || !control ||
        typeof control.setAuthHandlers !== 'function' || !contextToken ||
        typeof contextToken !== 'object') {
      throw new TypeError('a generation-bound auth control suite is required');
    }
    this.detach();
    this.binding = { generation, control, contextToken };
    control.setAuthHandlers({
      onChallenge: (challenge) => this.#activate(generation, control, challenge),
      onCleared: () => this.#clear(generation, control),
    });
  }

  detach(expectedGeneration = null) {
    if (!this.binding || (expectedGeneration !== null &&
        this.binding.generation !== expectedGeneration)) return false;
    this.binding.control.setAuthHandlers({});
    this.binding = null;
    this.inFlight = false;
    this.#clearExpiryTimer();
    if (this.publicView) {
      this.publicView = null;
      this.publish(null);
    }
    return true;
  }

  snapshot() {
    if (this.binding && !this.#contextCurrent()) this.detach();
    return this.publicView ? { ...this.publicView } : null;
  }

  ipcHandlers() {
    return {
      'respond-auth-challenge': (_event, payload) => this.#ipcResult(() => this.respond(payload)),
      'resend-auth-challenge': () => this.#ipcResult(() => this.resend()),
      'cancel-auth-challenge': () => this.#ipcResult(() => this.cancel()),
    };
  }

  respond(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        Object.keys(payload).some((key) => key !== 'response') ||
        typeof payload.response !== 'string') {
      return Promise.reject(new TypeError('authentication response is invalid'));
    }
    const length = Buffer.byteLength(payload.response, 'utf8');
    if (length === 0 || length > MAX_AUTH_RESPONSE_BYTES) {
      payload.response = '';
      return Promise.reject(new TypeError('authentication response has an invalid length'));
    }
    const secret = Buffer.from(payload.response, 'utf8');
    payload.response = '';
    let operation;
    try {
      operation = this.#run((control) => control.respond(secret));
    } finally {
      secret.fill(0);
    }
    return operation;
  }

  resend() {
    if (this.publicView?.kind === 'unknown' || !this.publicView?.resendAvailable ||
        (this.publicView.resendAfterUnixMs != null &&
          this.publicView.resendAfterUnixMs > this.now())) {
      return Promise.reject(new Error('authentication challenge resend is unavailable'));
    }
    return this.#run((control) => control.resend());
  }

  cancel() {
    return this.#run((control) => control.cancel());
  }

  cancelForLifecycle() {
    if (!this.binding || !this.publicView) return false;
    const { control } = this.binding;
    // Clear the renderer-facing state before best-effort I/O. Lifecycle loss
    // must not leave a ghost prompt, and it must be able to race an in-flight
    // submit without waiting for that renderer-owned operation to settle.
    this.detach();
    Promise.resolve().then(() => control.cancel()).catch(() => {});
    return true;
  }

  #run(action) {
    if (!this.binding || !this.publicView) {
      return Promise.reject(new Error('no active authentication challenge'));
    }
    if (!this.#contextCurrent()) {
      this.detach();
      const error = new Error('authentication challenge belongs to a stale context');
      error.code = 'stale_context';
      return Promise.reject(error);
    }
    if (this.inFlight) return Promise.reject(new Error('authentication action is in progress'));
    this.inFlight = true;
    let operation;
    try {
      operation = action(this.binding.control);
    } catch (error) {
      this.inFlight = false;
      return Promise.reject(error);
    }
    return Promise.resolve(operation).finally(() => { this.inFlight = false; });
  }

  async #ipcResult(action) {
    try {
      await action();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code: PUBLIC_ERROR_CODES.has(error?.code) ? error.code : 'provider_failure',
      };
    }
  }

  #activate(generation, control, challenge) {
    if (!this.binding || this.binding.generation !== generation ||
        this.binding.control !== control || !this.#contextCurrent()) return;
    this.publicView = rendererChallengeView(challenge);
    this.publish(this.snapshot());
    this.#scheduleExpiry(generation, control);
  }

  #clear(generation, control) {
    if (!this.binding || this.binding.generation !== generation ||
        this.binding.control !== control || !this.#contextCurrent()) return;
    this.#clearExpiryTimer();
    if (!this.publicView) return;
    this.publicView = null;
    this.publish(null);
  }

  #scheduleExpiry(generation, control) {
    this.#clearExpiryTimer();
    const expiresAt = this.publicView?.expiresAtUnixMs;
    if (expiresAt == null) return;
    const schedule = () => {
      if (!this.binding || this.binding.generation !== generation ||
          this.binding.control !== control || !this.#contextCurrent() ||
          this.publicView?.expiresAtUnixMs !== expiresAt) return;
      const remaining = expiresAt - this.now();
      if (remaining > 0) {
        this.expiryTimer = this.setTimeoutFn(schedule, Math.min(remaining, MAX_TIMER_DELAY_MS));
        this.expiryTimer.unref?.();
        return;
      }
      this.expiryTimer = null;
      Promise.resolve().then(() => control.cancel()).catch(() => {});
      this.#clear(generation, control);
    };
    schedule();
  }

  #clearExpiryTimer() {
    if (this.expiryTimer) this.clearTimeoutFn(this.expiryTimer);
    this.expiryTimer = null;
  }

  #contextCurrent() {
    return Boolean(this.binding && this.isContextCurrent(this.binding.contextToken));
  }
}

module.exports = {
  AuthChallengeCoordinator,
  MAX_AUTH_RESPONSE_BYTES,
  rendererChallengeView,
};
