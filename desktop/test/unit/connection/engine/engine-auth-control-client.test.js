'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EngineAuthControlClient,
  EngineAuthControlParser,
  normalizeAuthControlMessage,
} = require('../../../../lib/connection/engine/engine-auth-control-client');

const CHALLENGE = Object.freeze({
  transactionId: '04040404040404040404040404040404',
  challengeEpoch: 1,
  kind: 'otp',
  deliveryChannel: 'unknown',
  maskedDestination: 'masked-fixture',
  expiresAtUnixMs: null,
  resendAvailable: true,
  resendAfterUnixMs: null,
  attemptsRemaining: 3,
});

class FakeWritable {
  constructor() {
    this.frames = [];
    this.frameReferences = [];
    this.failure = null;
    this.destroyed = false;
  }

  write(frame, callback) {
    this.frameReferences.push(frame);
    this.frames.push(JSON.parse(Buffer.from(frame).toString('utf8')));
    callback?.(this.failure);
    return true;
  }

  destroy() { this.destroyed = true; }
}

function challengeEvent(type = 'auth_challenge_required', challenge = CHALLENGE) {
  return `${JSON.stringify({ type, apiVersion: 3, challenge })}\n`;
}

test('auth parser accepts split v3 frames and ignores v1/v2 output', () => {
  const parser = new EngineAuthControlParser();
  assert.deepEqual(parser.feed('{"type":"hello","apiVersion":1,"capabilities":[]}\n'), []);
  assert.deepEqual(parser.feed('{"type":"control_hello","apiVersion":2,"requestId":1,"capabilities":[]}\n'), []);
  const frame = challengeEvent();
  assert.deepEqual(parser.feed(frame.slice(0, 40)), []);
  const messages = parser.feed(frame.slice(40));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].challenge.kind, 'otp');
});

test('auth messages reject unknown or secret-bearing challenge metadata', () => {
  assert.equal(normalizeAuthControlMessage({
    type: 'auth_challenge_required',
    apiVersion: 3,
    challenge: { ...CHALLENGE, gatewayToken: 'not-allowed' },
  }), null);
  assert.equal(normalizeAuthControlMessage({
    type: 'auth_challenge_required',
    apiVersion: 3,
    challenge: { ...CHALLENGE, maskedDestination: 'line\nbreak' },
  }), null);
  assert.equal(normalizeAuthControlMessage({
    type: 'auth_error', apiVersion: 3, requestId: 4, code: 'provider_private_detail',
  }), null);
});

test('client binds every command to Engine-owned context and zeroizes the wire frame', async () => {
  const writable = new FakeWritable();
  const challenges = [];
  const client = new EngineAuthControlClient({ writable, generation: 9 });
  client.setHandlers({ onChallenge: (challenge) => challenges.push(challenge) });
  client.feed(challengeEvent());
  assert.equal(challenges.length, 1);

  const secret = Buffer.from('synthetic-accepted');
  const response = client.respond(secret);
  assert.deepEqual(writable.frames[0], {
    type: 'auth_request',
    apiVersion: 3,
    requestId: 1,
    generation: 9,
    transactionId: CHALLENGE.transactionId,
    challengeEpoch: 1,
    command: { name: 'respond', response: 'synthetic-accepted' },
  });
  assert.ok(writable.frameReferences[0].every((byte) => byte === 0));
  client.feed('{"type":"auth_complete","apiVersion":3,"requestId":1}\n');
  assert.equal((await response).type, 'auth_complete');
  assert.equal(client.challenge, null);
  secret.fill(0);
});

test('resend accepts a higher challenge epoch and stale stable errors contain no provider text', async () => {
  const writable = new FakeWritable();
  const client = new EngineAuthControlClient({ writable, generation: 12 });
  client.feed(challengeEvent());
  const resend = client.resend();
  assert.equal(writable.frames[0].command.name, 'resend');
  const updated = { ...CHALLENGE, challengeEpoch: 2, resendAvailable: false };
  client.feed(`${JSON.stringify({
    type: 'auth_challenge', apiVersion: 3, requestId: 1, challenge: updated,
  })}\n`);
  assert.equal((await resend).challenge.challengeEpoch, 2);

  const cancel = client.cancel();
  client.feed('{"type":"auth_error","apiVersion":3,"requestId":2,"code":"stale_context"}\n');
  await assert.rejects(cancel, (error) => (
    error.code === 'stale_context' && !error.message.includes('synthetic-accepted')
  ));
  assert.notEqual(client.challenge, null, 'a stale cancel must preserve the valid transaction');
});

test('provider cleanup failure after cancel closes the terminal challenge', async () => {
  const writable = new FakeWritable();
  const cleared = [];
  const client = new EngineAuthControlClient({ writable, generation: 9 });
  client.setHandlers({ onCleared: (reason) => cleared.push(reason) });
  client.feed(challengeEvent());
  const cancel = client.cancel();
  client.feed('{"type":"auth_error","apiVersion":3,"requestId":1,"code":"provider_failure"}\n');
  await assert.rejects(cancel, (error) => error.code === 'provider_failure');
  assert.equal(client.challenge, null);
  assert.deepEqual(cleared, ['provider_failure']);
  await assert.rejects(client.respond(Buffer.from('late')), /no active/);
});

test('Engine budget exhaustion clears the challenge and rejects later secrets', async () => {
  const writable = new FakeWritable();
  const client = new EngineAuthControlClient({ writable, generation: 9 });
  client.feed(challengeEvent());
  const response = client.respond(Buffer.from('synthetic-limit'));
  client.feed('{"type":"auth_error","apiVersion":3,"requestId":1,"code":"limit_exceeded"}\n');
  await assert.rejects(response, (error) => error.code === 'limit_exceeded');
  assert.equal(client.challenge, null);
  await assert.rejects(client.resend(), /no active/);
});

test('malformed and oversized frames are discarded without unbounded buffering', () => {
  const parser = new EngineAuthControlParser({ maxFrameBytes: 128, maxBufferBytes: 160 });
  assert.deepEqual(parser.feed('not-json\n'), []);
  assert.deepEqual(parser.feed('x'.repeat(200)), []);
  assert.deepEqual(parser.feed(`discarded\n${challengeEvent()}`), []);
  assert.ok(parser.buffer.length <= 160);
});

test('auth response timeout closes the shared pipe and clears the challenge fail-closed', async () => {
  let timeoutCallback;
  const writable = new FakeWritable();
  const client = new EngineAuthControlClient({
    writable,
    generation: 9,
    setTimeoutFn: (callback) => { timeoutCallback = callback; return { unref() {} }; },
    clearTimeoutFn: () => {},
  });
  client.feed(challengeEvent());
  const response = client.respond(Buffer.from('synthetic-timeout'));
  timeoutCallback();
  await assert.rejects(response, /timed out/);
  assert.equal(writable.destroyed, true);
  assert.equal(client.closed, true);
  assert.equal(client.challenge, null);
  client.feed(challengeEvent());
  assert.equal(client.challenge, null, 'trailing stdout cannot revive a closed challenge');
});
