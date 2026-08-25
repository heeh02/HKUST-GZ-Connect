'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ActiveContextLease } = require('../lib/active-context-lease');

function binding({
  profileId = 'school-a',
  profileRevision = 1,
  accountSeed = 'a',
  activeContextEpoch = 1,
} = {}) {
  return {
    profileId,
    profileRevision,
    accountHandle: `account-${accountSeed.repeat(36)}`,
    activeContextEpoch,
  };
}

test('token requires the exact active context intent and Engine generation', () => {
  const lease = new ActiveContextLease(binding());
  const token = lease.capture({ connectionIntent: 3, engineGeneration: 7 });
  assert.equal(lease.isContextCurrent(token), true);
  assert.equal(lease.isCurrent(token, { connectionIntent: 3, engineGeneration: 7 }), true);
  assert.equal(lease.isCurrent(token, { connectionIntent: 4, engineGeneration: 7 }), false);
  assert.equal(lease.isCurrent(token, { connectionIntent: 3, engineGeneration: 8 }), false);
  assert.equal(lease.isCurrent({}, { connectionIntent: 3, engineGeneration: 7 }), false);
  assert.equal(JSON.stringify(token), '"[active context token]"');
  assert.equal(String(token), '[active context token]');
  assert.equal(JSON.stringify(token).includes('school-a'), false);
  const contextToken = lease.captureContext();
  assert.equal(lease.isContextCurrent(contextToken), true);
  assert.equal(lease.isCurrent(contextToken, {
    connectionIntent: 3, engineGeneration: 7,
  }), false);
});

test('gating invalidates every borrowed token until a higher epoch activates', () => {
  const lease = new ActiveContextLease(binding());
  const old = lease.capture({ connectionIntent: 1, engineGeneration: 1 });
  assert.equal(lease.invalidate(), true);
  assert.equal(lease.invalidate(), false);
  assert.equal(lease.snapshot(), null);
  assert.equal(lease.isCurrent(old, { connectionIntent: 1, engineGeneration: 1 }), false);
  assert.equal(lease.isContextCurrent(old), false);
  assert.throws(() => lease.capture({ connectionIntent: 1, engineGeneration: 1 }), /gated/u);
  assert.throws(() => lease.activate(binding()), /increase monotonically/u);

  const current = lease.activate(binding({
    profileId: 'school-b', accountSeed: 'b', activeContextEpoch: 2,
  }));
  assert.equal(current.profileId, 'school-b');
  assert.equal(lease.isCurrent(old, { connectionIntent: 1, engineGeneration: 1 }), false);
  const next = lease.capture({ connectionIntent: 2, engineGeneration: 2 });
  assert.equal(lease.isCurrent(next, { connectionIntent: 2, engineGeneration: 2 }), true);
});

test('context binding is exact bounded and contains no persistent storage key', () => {
  assert.throws(() => new ActiveContextLease({ ...binding(), accountKey: 'forbidden' }),
    /invalid schema/u);
  assert.throws(() => new ActiveContextLease(binding({ activeContextEpoch: 0 })), /positive/u);
  assert.throws(() => new ActiveContextLease(binding({ accountSeed: '-' })), /opaque handle/u);
  const lease = new ActiveContextLease(binding());
  assert.throws(() => lease.capture({ connectionIntent: 0, engineGeneration: 1 }), /positive/u);
});

test('100 context activations reject every token from an older epoch', () => {
  const lease = new ActiveContextLease(binding());
  let token = lease.capture({ connectionIntent: 1, engineGeneration: 1 });
  for (let epoch = 2; epoch <= 101; epoch++) {
    const stale = token;
    lease.invalidate();
    lease.activate(binding({
      profileId: epoch % 2 === 0 ? 'school-b' : 'school-a',
      accountSeed: epoch % 2 === 0 ? 'b' : 'a',
      activeContextEpoch: epoch,
    }));
    assert.equal(lease.isCurrent(stale, {
      connectionIntent: epoch - 1,
      engineGeneration: epoch - 1,
    }), false);
    token = lease.capture({ connectionIntent: epoch, engineGeneration: epoch });
    assert.equal(lease.isCurrent(token, {
      connectionIntent: epoch,
      engineGeneration: epoch,
    }), true);
  }
});
