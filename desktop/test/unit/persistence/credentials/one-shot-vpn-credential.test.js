'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  OneShotVpnCredentialBroker,
} = require('../../../../lib/persistence/credentials/one-shot-vpn-credential');

const request = (overrides = {}) => ({
  profileId: 'hkustgz',
  username: 'synthetic-user',
  password: 'synthetic-password',
  ...overrides,
});

test('memory-only credential can be taken exactly once and zeroizes after use', () => {
  const broker = new OneShotVpnCredentialBroker();
  const staged = broker.stage(request());
  assert.deepEqual(staged, { ok: true, revision: 1, storage: 'memory_only' });
  assert.equal(broker.has({ profileId: 'hkustgz' }), true);
  assert.equal(JSON.stringify(broker).includes('synthetic'), false);

  const owner = broker.take({ profileId: 'hkustgz', revision: staged.revision });
  assert.equal(broker.has({ profileId: 'hkustgz' }), false);
  assert.deepEqual(owner.withStrings((username, password) => ({ username, password })), {
    username: 'synthetic-user', password: 'synthetic-password',
  });
  assert.throws(() => owner.withStrings(() => true), /unavailable/u);
  assert.equal(owner.destroy(), false);
  assert.equal(broker.take({ profileId: 'hkustgz' }), null);
});

test('memory-only credential can be reopened for bounded in-process retries until cleared', () => {
  const broker = new OneShotVpnCredentialBroker();
  const staged = broker.stage(request());
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const owner = broker.open({ profileId: 'hkustgz', revision: staged.revision });
    assert.equal(owner.withStrings((_username, password) => password), 'synthetic-password');
    assert.equal(broker.has({ profileId: 'hkustgz' }), true,
      'destroying a per-attempt lease must not erase the process-lifetime credential');
  }
  assert.equal(broker.clear(staged.revision), true);
  assert.equal(broker.open({ profileId: 'hkustgz' }), null);
});

test('replacement wins and stale revision operations cannot consume or clear it', () => {
  const broker = new OneShotVpnCredentialBroker();
  const first = broker.stage(request({ password: 'first-password' }));
  const second = broker.stage(request({ password: 'second-password' }));
  assert.equal(second.revision, first.revision + 1);
  assert.equal(broker.clear(first.revision), false);
  assert.equal(broker.take({ profileId: 'hkustgz', revision: first.revision }), null);
  const owner = broker.take({ profileId: 'hkustgz', revision: second.revision });
  assert.equal(owner.withStrings((_username, password) => password), 'second-password');
});

test('Profile mismatch clears stale memory-only credentials instead of retaining them', () => {
  const broker = new OneShotVpnCredentialBroker();
  broker.stage(request());
  assert.equal(broker.take({ profileId: 'school-b' }), null);
  assert.deepEqual(broker.snapshot(), { present: false, profileId: null, revision: null });
});

test('credential schema is bounded, control-free, synchronous, and redacted', () => {
  const broker = new OneShotVpnCredentialBroker();
  assert.throws(() => broker.stage(request({ profileId: '../school' })), /Profile/u);
  assert.throws(() => broker.stage(request({ username: 'bad\nuser' })), /username/u);
  assert.throws(() => broker.stage(request({ password: 'x'.repeat(4097) })), /password/u);
  const staged = broker.stage(request());
  const owner = broker.take({ profileId: 'hkustgz', revision: staged.revision });
  assert.equal(String(owner).includes('synthetic'), false);
  assert.throws(() => owner.withStrings(async () => true), /synchronous/u);
  assert.equal(owner.destroy(), false);
});
