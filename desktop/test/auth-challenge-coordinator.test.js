'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AuthChallengeCoordinator } = require('../lib/auth-challenge-coordinator');

function internalChallenge(overrides = {}) {
  return {
    transactionId: '04040404040404040404040404040404',
    challengeEpoch: 1,
    kind: 'otp',
    deliveryChannel: 'email',
    maskedDestination: 's***@example.test',
    expiresAtUnixMs: null,
    resendAvailable: true,
    resendAfterUnixMs: null,
    attemptsRemaining: 3,
    ...overrides,
  };
}

class FakeControl {
  constructor() {
    this.handlers = {};
    this.actions = [];
    this.secretReference = null;
  }

  setAuthHandlers(handlers) { this.handlers = handlers; }

  respond(secret) {
    this.actions.push(['respond', Buffer.from(secret).toString('utf8')]);
    this.secretReference = secret;
    return Promise.resolve({ type: 'auth_challenge' });
  }

  resend() { this.actions.push(['resend']); return Promise.resolve({ type: 'auth_challenge' }); }

  cancel() { this.actions.push(['cancel']); return Promise.resolve({ type: 'auth_cancelled' }); }
}

test('renderer view omits Engine correlation and protocol context', () => {
  const published = [];
  const control = new FakeControl();
  const coordinator = new AuthChallengeCoordinator({ publish: (view) => published.push(view) });
  coordinator.bind(9, control);
  control.handlers.onChallenge(internalChallenge());

  assert.deepEqual(Object.keys(published[0]).sort(), [
    'attemptsRemaining',
    'deliveryChannel',
    'expiresAtUnixMs',
    'kind',
    'maskedDestination',
    'resendAfterUnixMs',
    'resendAvailable',
  ]);
  const serialized = JSON.stringify(published[0]);
  for (const forbidden of ['transactionId', 'challengeEpoch', 'generation', 'cookie', 'csrf', 'token']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('response is removed from IPC payload and its Main-process Buffer is zeroized immediately', async () => {
  const control = new FakeControl();
  const coordinator = new AuthChallengeCoordinator();
  coordinator.bind(9, control);
  control.handlers.onChallenge(internalChallenge());
  const payload = { response: 'synthetic-accepted' };
  const operation = coordinator.respond(payload);
  assert.equal(payload.response, '');
  assert.ok(control.secretReference.every((byte) => byte === 0));
  await operation;
  assert.deepEqual(control.actions, [['respond', 'synthetic-accepted']]);
});

test('unknown fields, empty responses, duplicate actions and cooldown resend fail closed', async () => {
  let resolveResponse;
  const control = new FakeControl();
  control.respond = () => new Promise((resolve) => { resolveResponse = resolve; });
  const coordinator = new AuthChallengeCoordinator({ now: () => 1_000 });
  coordinator.bind(9, control);
  control.handlers.onChallenge(internalChallenge({ resendAfterUnixMs: 2_000 }));

  await assert.rejects(coordinator.respond({ response: 'x', extra: true }), /invalid/);
  const empty = { response: '' };
  await assert.rejects(coordinator.respond(empty), /invalid length/);
  assert.equal(empty.response, '');
  await assert.rejects(coordinator.resend(), /unavailable/);
  const active = coordinator.respond({ response: 'first' });
  await assert.rejects(coordinator.cancel(), /in progress/);
  resolveResponse({ type: 'auth_challenge' });
  await active;

  control.handlers.onChallenge(internalChallenge({ kind: 'unknown', resendAfterUnixMs: null }));
  await assert.rejects(coordinator.resend(), /unavailable/);
});

test('expiry cancels the bound transaction, clears UI, and stale generations cannot revive it', async () => {
  const published = [];
  let timerCallback;
  const control = new FakeControl();
  const coordinator = new AuthChallengeCoordinator({
    publish: (view) => published.push(view),
    now: () => 2_000,
    setTimeoutFn: (callback) => { timerCallback = callback; return { unref() {} }; },
    clearTimeoutFn: () => {},
  });
  coordinator.bind(4, control);
  control.handlers.onChallenge(internalChallenge({ expiresAtUnixMs: 1_500 }));
  assert.equal(timerCallback, undefined, 'already-expired challenge clears synchronously');
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(control.actions, [['cancel']]);
  assert.equal(published.at(-1), null);
  const staleHandler = control.handlers.onChallenge;
  coordinator.detach(4);
  staleHandler(internalChallenge());
  assert.equal(coordinator.snapshot(), null);
});

test('expiry cleanup remains fail-closed when the control client throws synchronously', async () => {
  const published = [];
  const control = new FakeControl();
  control.cancel = () => { throw new Error('synthetic cleanup failure'); };
  const coordinator = new AuthChallengeCoordinator({
    publish: (view) => published.push(view),
    now: () => 2_000,
  });
  coordinator.bind(4, control);
  assert.doesNotThrow(() => {
    control.handlers.onChallenge(internalChallenge({ expiresAtUnixMs: 1_500 }));
  });
  await new Promise((done) => setImmediate(done));
  assert.equal(coordinator.snapshot(), null);
  assert.equal(published.at(-1), null);
});
