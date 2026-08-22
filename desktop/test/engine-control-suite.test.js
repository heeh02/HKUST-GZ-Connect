'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EngineControlSuite } = require('../lib/engine-control-suite');

class FakeWritable {
  constructor() { this.frames = []; }
  write(frame, callback) {
    this.frames.push(JSON.parse(Buffer.from(frame).toString('utf8')));
    callback?.();
    return true;
  }
}

test('suite keeps v2 supervision and v3 interactive auth as separate schemas on one pipe', async () => {
  const writable = new FakeWritable();
  const suite = new EngineControlSuite({ writable, generation: 9 });
  const challenges = [];
  suite.setAuthHandlers({ onChallenge: (challenge) => challenges.push(challenge) });

  const hello = suite.handshake();
  suite.feed('{"type":"control_hello","apiVersion":2,"requestId":1,"capabilities":["engine.shutdown"]}\n');
  await hello;
  suite.feed('{"type":"auth_challenge_required","apiVersion":3,"challenge":{"transactionId":"04040404040404040404040404040404","challengeEpoch":1,"kind":"otp","deliveryChannel":null,"maskedDestination":null,"expiresAtUnixMs":null,"resendAvailable":false,"resendAfterUnixMs":null,"attemptsRemaining":null}}\n');
  assert.equal(challenges.length, 1);

  const cancel = suite.cancel();
  assert.equal(writable.frames[0].type, 'hello');
  assert.equal(writable.frames[1].type, 'auth_request');
  assert.equal(writable.frames[1].command.name, 'cancel');
  suite.feed('{"type":"auth_cancelled","apiVersion":3,"requestId":1}\n');
  await cancel;
  suite.close();
});
