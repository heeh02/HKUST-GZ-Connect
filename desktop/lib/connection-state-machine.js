'use strict';

const { planReconnect } = require('./reconnect-policy');

const CONNECTION_PHASE = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  STOPPING: 'stopping',
  RETRY_WAIT: 'retry-wait',
  CONNECTIVITY_PAUSED: 'connectivity-paused',
});

function validGeneration(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Pure connection-lifecycle decisions. Process ownership and all I/O remain in
// main.js/EngineSupervisor; this object owns only the user intent, desired
// state, retry budget, and the generation token accepted by lifecycle events.
class ConnectionStateMachine {
  #intent;
  #desiredConnected;
  #userDisconnected;
  #attempts;
  #phase;
  #engineGeneration;

  constructor() {
    this.#intent = 0;
    this.#desiredConnected = false;
    this.#userDisconnected = false;
    this.#attempts = 0;
    this.#phase = CONNECTION_PHASE.IDLE;
    this.#engineGeneration = null;
  }

  snapshot() {
    return Object.freeze({
      intent: this.#intent,
      desiredConnected: this.#desiredConnected,
      userDisconnected: this.#userDisconnected,
      attempts: this.#attempts,
      attemptNumber: this.#attempts + 1,
      phase: this.#phase,
      engineGeneration: this.#engineGeneration,
    });
  }

  isCurrentIntent(intent) {
    return Number.isSafeInteger(intent) && intent === this.#intent;
  }

  canContinue(intent, { isQuitting = false } = {}) {
    return !isQuitting && this.isCurrentIntent(intent) && this.#desiredConnected;
  }

  canAttempt(intent, { isQuitting = false } = {}) {
    return this.canContinue(intent, { isQuitting }) && !this.#userDisconnected;
  }

  currentRecoveryIntent({ isQuitting = false } = {}) {
    return !isQuitting && this.#desiredConnected ? this.#intent : null;
  }

  canRecover(intent, { isQuitting = false, autoReconnect = true } = {}) {
    return autoReconnect && this.canContinue(intent, { isQuitting });
  }

  nextIntent(wantsConnected) {
    if (this.#intent === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('connection lifecycle intent exhausted');
    }
    this.#intent += 1;
    this.#desiredConnected = wantsConnected === true;
    return this.#intent;
  }

  beginConnectIntent() {
    return this.nextIntent(true);
  }

  beginConnectAttempt(intent, { isRetry = false } = {}) {
    if (!this.canContinue(intent)) return false;
    if (!isRetry) {
      this.#attempts = 0;
      this.#userDisconnected = false;
    }
    this.#phase = CONNECTION_PHASE.CONNECTING;
    return true;
  }

  beginStop(wantsConnectedAfterStop) {
    const intent = this.nextIntent(wantsConnectedAfterStop === true);
    this.#userDisconnected = true;
    this.#phase = CONNECTION_PHASE.STOPPING;
    this.invalidateEngineGeneration();
    return intent;
  }

  stopCompleted(intent, { ok } = {}) {
    if (!this.isCurrentIntent(intent)) return { action: 'stale' };
    if (!ok || !this.#desiredConnected) this.#phase = CONNECTION_PHASE.IDLE;
    return { action: ok ? 'stopped' : 'failed', desiredConnected: this.#desiredConnected };
  }

  resumeAfterStop(intent) {
    if (!this.canContinue(intent)) return false;
    this.#userDisconnected = false;
    this.#phase = CONNECTION_PHASE.CONNECTING;
    return true;
  }

  pauseForConnectivity(intent, { isQuitting = false } = {}) {
    if (!this.canContinue(intent, { isQuitting })) return false;
    this.#phase = CONNECTION_PHASE.CONNECTIVITY_PAUSED;
    this.invalidateEngineGeneration();
    return true;
  }

  resumeConnectivity(intent, { isQuitting = false, autoReconnect = true } = {}) {
    if (!this.canRecover(intent, { isQuitting, autoReconnect })) return false;
    this.#userDisconnected = false;
    this.#phase = CONNECTION_PHASE.CONNECTING;
    return true;
  }

  bindEngineGeneration(generation) {
    if (!validGeneration(generation) || !this.#desiredConnected) return false;
    this.#engineGeneration = generation;
    return true;
  }

  invalidateEngineGeneration() {
    const previous = this.#engineGeneration;
    this.#engineGeneration = null;
    return previous;
  }

  isCurrentGeneration(generation) {
    return validGeneration(generation) && generation === this.#engineGeneration;
  }

  markConnecting(generation) {
    if (!this.isCurrentGeneration(generation) || !this.#desiredConnected ||
        this.#userDisconnected) return false;
    this.#phase = CONNECTION_PHASE.CONNECTING;
    return true;
  }

  markConnected(generation) {
    if (!this.isCurrentGeneration(generation) || !this.#desiredConnected ||
        this.#userDisconnected) return false;
    this.#phase = CONNECTION_PHASE.CONNECTED;
    return true;
  }

  failIntent(intent = this.#intent) {
    if (!this.isCurrentIntent(intent)) return false;
    this.#desiredConnected = false;
    this.#phase = CONNECTION_PHASE.IDLE;
    return true;
  }

  engineClosed({
    generation,
    supervisorGenerationCurrent = true,
    terminalFailure = false,
    autoReconnect = true,
    maxAttempts = 0,
    wasConnected = false,
    uptimeMs = 0,
    failureKind = 'unknown',
  } = {}) {
    // Both tokens are required. EngineSupervisor owns process generation;
    // this mirror ensures an explicit stop/connectivity invalidation wins even
    // if an old close callback arrives after a new lifecycle intent.
    if (!supervisorGenerationCurrent || !this.isCurrentGeneration(generation)) {
      return Object.freeze({ action: 'ignored' });
    }
    this.#engineGeneration = null;
    this.#phase = CONNECTION_PHASE.IDLE;

    if (this.#userDisconnected || !this.#desiredConnected || terminalFailure) {
      if (terminalFailure) this.#desiredConnected = false;
      return Object.freeze({
        action: terminalFailure ? 'terminal' : 'settled',
        desiredConnected: this.#desiredConnected,
      });
    }

    const retry = autoReconnect ? planReconnect({
      attempts: this.#attempts,
      maxAttempts,
      wasConnected,
      uptimeMs,
      failureKind,
    }) : null;
    if (retry) {
      this.#attempts = retry.attempt;
      this.#phase = CONNECTION_PHASE.RETRY_WAIT;
      return Object.freeze({ action: 'retry', ...retry });
    }

    this.#desiredConnected = false;
    return Object.freeze({ action: 'exhausted' });
  }

  shouldStopWaiting({ connecting = false, hasActive = false, lastError = null } = {}) {
    return this.#userDisconnected || (!connecting && !hasActive && Boolean(lastError));
  }
}

module.exports = { CONNECTION_PHASE, ConnectionStateMachine };
