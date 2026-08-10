'use strict';

const crypto = require('node:crypto');
const util = require('node:util');

const RANDOM_SECRET_BYTES = 24;
const LOOPBACK_PROXY_HOST = '127.0.0.1';

function randomSecret(randomBytes) {
  const entropy = randomBytes(RANDOM_SECRET_BYTES);
  if (!Buffer.isBuffer(entropy) || entropy.length !== RANDOM_SECRET_BYTES) {
    throw new Error('secure proxy credential generation failed');
  }
  return Buffer.from(entropy.toString('base64url'), 'ascii');
}

function injectedSecret(value) {
  const secret = Buffer.isBuffer(value)
    ? Buffer.from(value)
    : (typeof value === 'string' ? Buffer.from(value, 'ascii') : null);
  if (!secret || secret.length < 16 || secret.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(secret.toString('ascii'))) {
    secret?.fill(0);
    throw new Error('secure proxy credential injection failed');
  }
  return secret;
}

class EphemeralProxyCredential {
  #username;
  #password;
  #generation = null;
  #port = null;
  #destroyed = false;

  constructor({ randomBytes = crypto.randomBytes, credential = null } = {}) {
    if (typeof randomBytes !== 'function') throw new TypeError('randomBytes is required');
    if (credential !== null) {
      if (!credential || typeof credential !== 'object') {
        throw new TypeError('credential is invalid');
      }
      this.#username = injectedSecret(credential.username);
      try {
        this.#password = injectedSecret(credential.password);
      } catch (error) {
        this.#username.fill(0);
        throw error;
      }
      return;
    }
    this.#username = randomSecret(randomBytes);
    this.#password = randomSecret(randomBytes);
  }

  bindGeneration(generation, port) {
    if (this.#destroyed || !Number.isSafeInteger(generation) || generation <= 0 ||
        !Number.isInteger(Number(port)) || Number(port) < 1025 || Number(port) > 65535 ||
        this.#generation !== null) return false;
    this.#generation = generation;
    this.#port = Number(port);
    return true;
  }

  isForGeneration(generation) {
    return !this.#destroyed && this.#generation === generation;
  }

  stdinSuffix(generation) {
    if (!this.isForGeneration(generation)) throw new Error('proxy credential is unavailable');
    return `${this.#username.toString('ascii')}\n${this.#password.toString('ascii')}\n`;
  }

  socksAuthentication(generation) {
    if (!this.isForGeneration(generation)) return null;
    // These are read-only borrowed views for the short-lived local health
    // handshake. destroy() zeroes the same backing buffers synchronously.
    return { username: this.#username, password: this.#password };
  }

  matchesProxyChallenge(authInfo, generation) {
    return this.isForGeneration(generation) &&
      authInfo?.isProxy === true &&
      String(authInfo.scheme || '').toLowerCase() === 'basic' &&
      authInfo.host === LOOPBACK_PROXY_HOST && Number(authInfo.port) === this.#port;
  }

  answerProxyChallenge(authInfo, generation, callback) {
    if (typeof callback !== 'function' || !this.matchesProxyChallenge(authInfo, generation)) {
      return false;
    }
    callback(this.#username.toString('ascii'), this.#password.toString('ascii'));
    return true;
  }

  destroy(expectedGeneration = null) {
    if (this.#destroyed || (expectedGeneration !== null && this.#generation !== expectedGeneration)) {
      return false;
    }
    this.#username.fill(0);
    this.#password.fill(0);
    this.#generation = null;
    this.#port = null;
    this.#destroyed = true;
    return true;
  }

  toJSON() {
    return { type: 'EphemeralProxyCredential', redacted: true, destroyed: this.#destroyed };
  }

  [util.inspect.custom]() {
    return `EphemeralProxyCredential { <redacted>, destroyed: ${this.#destroyed} }`;
  }
}

module.exports = {
  EphemeralProxyCredential,
  LOOPBACK_PROXY_HOST,
  RANDOM_SECRET_BYTES,
};
