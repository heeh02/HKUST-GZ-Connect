'use strict';

const util = require('node:util');
const {
  validateAccountHandle,
  validateProfileId,
} = require('./school-profile-schema');

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, name) {
  const source = plainObject(value, name);
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} has an invalid schema`);
  }
  return source;
}

function positive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function binding(value) {
  const source = exactKeys(value, [
    'profileId', 'profileRevision', 'accountHandle', 'activeContextEpoch',
  ], 'active context binding');
  return Object.freeze({
    profileId: validateProfileId(source.profileId),
    profileRevision: positive(source.profileRevision, 'profileRevision'),
    accountHandle: validateAccountHandle(source.accountHandle),
    activeContextEpoch: positive(source.activeContextEpoch, 'activeContextEpoch'),
  });
}

function lifecycle(value) {
  const source = exactKeys(value, [
    'connectionIntent', 'engineGeneration',
  ], 'active context lifecycle');
  return Object.freeze({
    connectionIntent: positive(source.connectionIntent, 'connectionIntent'),
    engineGeneration: positive(source.engineGeneration, 'engineGeneration'),
  });
}

function sameContext(left, right) {
  return left.profileId === right.profileId &&
    left.profileRevision === right.profileRevision &&
    left.accountHandle === right.accountHandle &&
    left.activeContextEpoch === right.activeContextEpoch;
}

function redactedToken() {
  return Object.freeze({
    toJSON: () => '[active context token]',
    toString: () => '[active context token]',
    [util.inspect.custom]: () => '[active context token]',
  });
}

class ActiveContextLease {
  #current = null;
  #epochFloor = 0;
  #tokens = new WeakMap();

  constructor(initialBinding) {
    this.activate(initialBinding);
  }

  snapshot() {
    return this.#current;
  }

  capture(lifecycleValue) {
    if (this.#current === null) throw new Error('active context is gated');
    return this.#issue(lifecycle(lifecycleValue));
  }

  captureContext() {
    if (this.#current === null) throw new Error('active context is gated');
    return this.#issue(null);
  }

  #issue(lifecycleBinding) {
    const token = redactedToken();
    this.#tokens.set(token, Object.freeze({
      context: this.#current,
      lifecycle: lifecycleBinding,
    }));
    return token;
  }

  isCurrent(token, lifecycleValue) {
    if (!this.isContextCurrent(token)) return false;
    const observed = this.#tokens.get(token);
    if (observed.lifecycle === null) return false;
    let currentLifecycle;
    try { currentLifecycle = lifecycle(lifecycleValue); }
    catch { return false; }
    return observed.lifecycle.connectionIntent === currentLifecycle.connectionIntent &&
      observed.lifecycle.engineGeneration === currentLifecycle.engineGeneration;
  }

  isContextCurrent(token) {
    if (this.#current === null || !token || typeof token !== 'object') return false;
    const observed = this.#tokens.get(token);
    return Boolean(observed && sameContext(observed.context, this.#current));
  }

  invalidate() {
    if (this.#current === null) return false;
    this.#epochFloor = Math.max(this.#epochFloor, this.#current.activeContextEpoch);
    this.#current = null;
    return true;
  }

  activate(value) {
    const next = binding(value);
    const floor = this.#current === null
      ? this.#epochFloor
      : Math.max(this.#epochFloor, this.#current.activeContextEpoch);
    if (next.activeContextEpoch <= floor) {
      throw new TypeError('active context epoch must increase monotonically');
    }
    this.#epochFloor = next.activeContextEpoch;
    this.#current = next;
    return this.#current;
  }
}

module.exports = { ActiveContextLease };
