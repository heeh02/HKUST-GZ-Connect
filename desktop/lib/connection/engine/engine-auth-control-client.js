'use strict';

const ENGINE_AUTH_CONTROL_API_VERSION = 3;
const MAX_AUTH_CONTROL_FRAME_BYTES = 8 * 1024;
const MAX_AUTH_CONTROL_BUFFER_BYTES = 16 * 1024;
const MAX_AUTH_RESPONSE_BYTES = 4096;
const DEFAULT_AUTH_REQUEST_TIMEOUT_MS = 30_000;

const TRANSACTION_ID = /^[0-9a-f]{32}$/u;
const CHALLENGE_KINDS = new Set(['captcha', 'otp', 'token', 'approval', 'unknown']);
const DELIVERY_CHANNELS = new Set(['sms', 'email', 'authenticator', 'device', 'unknown']);
const ERROR_CODES = new Set([
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
const CHALLENGE_KEYS = new Set([
  'transactionId',
  'challengeEpoch',
  'kind',
  'deliveryChannel',
  'maskedDestination',
  'expiresAtUnixMs',
  'resendAvailable',
  'resendAfterUnixMs',
  'attemptsRemaining',
]);

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function optionalPositiveSafeInteger(value) {
  return value == null || positiveSafeInteger(value);
}

function normalizeChallenge(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !CHALLENGE_KEYS.has(key)) ||
      typeof value.transactionId !== 'string' || !TRANSACTION_ID.test(value.transactionId) ||
      !Number.isInteger(value.challengeEpoch) || value.challengeEpoch <= 0 ||
      !CHALLENGE_KINDS.has(value.kind) || typeof value.resendAvailable !== 'boolean' ||
      !optionalPositiveSafeInteger(value.expiresAtUnixMs) ||
      !optionalPositiveSafeInteger(value.resendAfterUnixMs)) return null;
  if (value.deliveryChannel != null && !DELIVERY_CHANNELS.has(value.deliveryChannel)) return null;
  if (value.maskedDestination != null && (
    typeof value.maskedDestination !== 'string' || !value.maskedDestination ||
    Buffer.byteLength(value.maskedDestination, 'utf8') > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value.maskedDestination)
  )) return null;
  if (value.attemptsRemaining != null && (
    !Number.isInteger(value.attemptsRemaining) || value.attemptsRemaining < 0 ||
    value.attemptsRemaining > 0xffff_ffff
  )) return null;
  if (!value.resendAvailable && value.resendAfterUnixMs != null) return null;
  return Object.freeze({
    transactionId: value.transactionId,
    challengeEpoch: value.challengeEpoch,
    kind: value.kind,
    deliveryChannel: value.deliveryChannel ?? null,
    maskedDestination: value.maskedDestination ?? null,
    expiresAtUnixMs: value.expiresAtUnixMs ?? null,
    resendAvailable: value.resendAvailable,
    resendAfterUnixMs: value.resendAfterUnixMs ?? null,
    attemptsRemaining: value.attemptsRemaining ?? null,
  });
}

function normalizeAuthControlMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.apiVersion !== ENGINE_AUTH_CONTROL_API_VERSION) return null;
  if (value.type === 'auth_challenge_required' || value.type === 'auth_challenge_updated') {
    const challenge = normalizeChallenge(value.challenge);
    return challenge ? { type: value.type, apiVersion: 3, challenge } : null;
  }
  if (!positiveSafeInteger(value.requestId)) return null;
  if (value.type === 'auth_challenge') {
    const challenge = normalizeChallenge(value.challenge);
    return challenge ? {
      type: 'auth_challenge', apiVersion: 3, requestId: value.requestId, challenge,
    } : null;
  }
  if (value.type === 'auth_complete' || value.type === 'auth_cancelled') {
    return { type: value.type, apiVersion: 3, requestId: value.requestId };
  }
  if (value.type === 'auth_error' && ERROR_CODES.has(value.code)) {
    return { type: 'auth_error', apiVersion: 3, requestId: value.requestId, code: value.code };
  }
  return null;
}

class EngineAuthControlParser {
  constructor({
    maxFrameBytes = MAX_AUTH_CONTROL_FRAME_BYTES,
    maxBufferBytes = MAX_AUTH_CONTROL_BUFFER_BYTES,
  } = {}) {
    this.maxFrameBytes = maxFrameBytes;
    this.maxBufferBytes = maxBufferBytes;
    this.buffer = Buffer.alloc(0);
    this.discardUntilNewline = false;
  }

  feed(value) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''));
    if (!chunk.length) return [];
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxBufferBytes && !this.buffer.includes(0x0a)) {
      this.buffer.fill(0);
      this.buffer = Buffer.alloc(0);
      this.discardUntilNewline = true;
      return [];
    }
    const messages = [];
    while (true) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) break;
      const rawLine = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      if (this.discardUntilNewline) {
        this.discardUntilNewline = false;
        continue;
      }
      if (!rawLine.length || rawLine.length + 1 > this.maxFrameBytes) continue;
      try {
        const message = normalizeAuthControlMessage(JSON.parse(rawLine.toString('utf8')));
        if (message) messages.push(message);
      } catch {}
    }
    if (this.buffer.length > this.maxBufferBytes) {
      this.buffer.fill(0);
      this.buffer = Buffer.alloc(0);
      this.discardUntilNewline = true;
    }
    return messages;
  }

  reset() {
    this.buffer.fill(0);
    this.buffer = Buffer.alloc(0);
    this.discardUntilNewline = false;
  }
}

class EngineAuthControlClient {
  constructor({
    writable,
    generation,
    requestTimeoutMs = DEFAULT_AUTH_REQUEST_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    if (!writable || typeof writable.write !== 'function') {
      throw new TypeError('a writable engine auth control stream is required');
    }
    if (!positiveSafeInteger(generation)) throw new TypeError('a positive engine generation is required');
    this.writable = writable;
    this.generation = generation;
    this.requestTimeoutMs = requestTimeoutMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.parser = new EngineAuthControlParser();
    this.nextRequestId = 1;
    this.pending = new Map();
    this.inFlightFrames = new Set();
    this.challenge = null;
    this.handlers = {};
    this.closed = false;
  }

  setHandlers(handlers = {}) {
    this.handlers = handlers && typeof handlers === 'object' ? handlers : {};
  }

  feed(value) {
    if (this.closed) return;
    for (const message of this.parser.feed(value)) {
      if (message.type === 'auth_challenge_required' ||
          message.type === 'auth_challenge_updated') {
        this.#acceptChallenge(message.challenge);
        continue;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) continue;
      this.pending.delete(message.requestId);
      this.clearTimeoutFn(pending.timer);
      if (message.type === 'auth_challenge') {
        this.#acceptChallenge(message.challenge);
        pending.resolve(message);
      } else if (message.type === 'auth_complete') {
        this.#clearChallenge('complete');
        pending.resolve(message);
      } else if (message.type === 'auth_cancelled') {
        this.#clearChallenge('cancelled');
        pending.resolve(message);
      } else if (message.type === 'auth_error') {
        if ((pending.cancelRequest && message.code === 'provider_failure') ||
            message.code === 'transaction_closed' ||
            message.code === 'challenge_expired' || message.code === 'limit_exceeded') {
          this.#clearChallenge(message.code);
        }
        const error = new Error(`engine auth control request failed: ${message.code}`);
        error.code = message.code;
        pending.reject(error);
      } else {
        pending.reject(new Error('engine auth control response type mismatch'));
      }
    }
  }

  respond(secret) {
    if (!Buffer.isBuffer(secret) || secret.length === 0 || secret.length > MAX_AUTH_RESPONSE_BYTES) {
      return Promise.reject(new TypeError('authentication response has an invalid length'));
    }
    const roundTrip = Buffer.from(secret.toString('utf8'), 'utf8');
    const validUtf8 = roundTrip.equals(secret);
    roundTrip.fill(0);
    if (!validUtf8) return Promise.reject(new TypeError('authentication response must be UTF-8'));
    return this.#request((context) => {
      let response = secret.toString('utf8');
      const command = { name: 'respond', response };
      response = '';
      return { ...context, command };
    });
  }

  resend() {
    return this.#request((context) => ({ ...context, command: { name: 'resend' } }));
  }

  cancel() {
    return this.#request(
      (context) => ({ ...context, command: { name: 'cancel' } }),
      { cancelRequest: true },
    );
  }

  close(error = new Error('engine auth control stream closed')) {
    if (this.closed) return;
    this.closed = true;
    this.parser.reset();
    for (const pending of this.pending.values()) {
      this.clearTimeoutFn(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const frame of this.inFlightFrames) frame.fill(0);
    this.inFlightFrames.clear();
    this.#clearChallenge('closed');
  }

  #acceptChallenge(challenge) {
    this.challenge = challenge;
    this.handlers.onChallenge?.(challenge);
  }

  #clearChallenge(reason) {
    const hadChallenge = this.challenge !== null;
    this.challenge = null;
    if (hadChallenge) this.handlers.onCleared?.(reason);
  }

  #request(buildFrame, { cancelRequest = false } = {}) {
    if (this.closed) return Promise.reject(new Error('engine auth control stream is closed'));
    const challenge = this.challenge;
    if (!challenge) return Promise.reject(new Error('no active authentication challenge'));
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    if (!positiveSafeInteger(requestId)) {
      this.close(new Error('engine auth control request identifiers are exhausted'));
      return Promise.reject(new Error('engine auth control request identifiers are exhausted'));
    }
    let encoded;
    try {
      const frame = buildFrame({
        type: 'auth_request',
        apiVersion: ENGINE_AUTH_CONTROL_API_VERSION,
        requestId,
        generation: this.generation,
        transactionId: challenge.transactionId,
        challengeEpoch: challenge.challengeEpoch,
      });
      let serialized = JSON.stringify(frame);
      if (frame.command?.name === 'respond') frame.command.response = '';
      encoded = Buffer.from(`${serialized}\n`, 'utf8');
      serialized = '';
      if (encoded.length > MAX_AUTH_CONTROL_FRAME_BYTES) {
        encoded.fill(0);
        throw new Error('engine auth control frame is oversized');
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const timer = this.setTimeoutFn(() => {
        if (!this.pending.has(requestId)) return;
        const error = new Error('engine auth control request timed out');
        try { this.writable.destroy?.(); } catch {}
        this.close(error);
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(requestId, { resolve, reject, timer, cancelRequest });
      this.inFlightFrames.add(encoded);
      try {
        this.writable.write(encoded, (error) => {
          encoded.fill(0);
          this.inFlightFrames.delete(encoded);
          if (!error) return;
          const pending = this.pending.get(requestId);
          if (!pending) return;
          this.pending.delete(requestId);
          this.clearTimeoutFn(pending.timer);
          pending.reject(new Error('cannot write engine auth control request'));
        });
      } catch {
        encoded.fill(0);
        this.inFlightFrames.delete(encoded);
        const pending = this.pending.get(requestId);
        if (pending) {
          this.pending.delete(requestId);
          this.clearTimeoutFn(pending.timer);
          pending.reject(new Error('cannot write engine auth control request'));
        }
      }
    });
  }
}

module.exports = {
  DEFAULT_AUTH_REQUEST_TIMEOUT_MS,
  ENGINE_AUTH_CONTROL_API_VERSION,
  EngineAuthControlClient,
  EngineAuthControlParser,
  MAX_AUTH_CONTROL_BUFFER_BYTES,
  MAX_AUTH_CONTROL_FRAME_BYTES,
  MAX_AUTH_RESPONSE_BYTES,
  normalizeAuthControlMessage,
  normalizeChallenge,
};
