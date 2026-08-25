'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  createLegacyCredentialRollbackState,
  retireLegacyCredentialRollbackState,
  validateLegacyCredentialRollbackState,
} = require('../../../../../lib/persistence/migration/legacy-hkust/legacy-credential-rollback-state');

function journal() {
  return {
    migrationId: `migration-${'11'.repeat(16)}`,
    profileId: 'hkustgz',
    profileCredentialBindingRevision: 1,
    gatewayOrigin: 'https://remote.hkust-gz.edu.cn',
    protocolFamily: 'easyconnect-password-modern-l3-v1',
    identity: { accountKey: `account-${'22'.repeat(16)}` },
    accountCredentialRevision: 1,
  };
}

function receipt(value = Buffer.from('legacy-encrypted-password')) {
  return {
    present: true,
    bytes: value.length,
    sha256: crypto.createHash('sha256').update(value).digest('hex'),
  };
}

test('active rollback state binds one legacy ciphertext to exact migration and account identity', () => {
  const state = createLegacyCredentialRollbackState({
    journal: journal(),
    sourceReceipt: receipt(),
    now: () => 1_700_000_000_000,
  });
  assert.equal(state.state, 'active');
  assert.equal(state.accountKey, journal().identity.accountKey);
  assert.equal(state.sourceSha256, receipt().sha256);
  assert.equal(state.retiredAt, null);
  assert.deepEqual(validateLegacyCredentialRollbackState(JSON.parse(JSON.stringify(state))), state);
  for (const forbidden of ['username', 'password', 'cookie', 'token']) {
    assert.equal(Object.keys(state).includes(forbidden), false);
  }
});

test('retirement is monotonic, reason-bound and idempotent', () => {
  const active = createLegacyCredentialRollbackState({
    journal: journal(),
    sourceReceipt: receipt(),
    now: () => 1_700_000_000_000,
  });
  const retired = retireLegacyCredentialRollbackState(active, {
    reason: 'credential_replaced',
    now: () => 1_700_000_000_100,
  });
  assert.equal(retired.state, 'retired');
  assert.equal(retired.retirementReason, 'credential_replaced');
  assert.equal(retired.retiredAt, 1_700_000_000_100);
  assert.deepEqual(retireLegacyCredentialRollbackState(retired, {
    reason: 'credential_cleared',
    now: () => 1_700_000_000_200,
  }), retired);
});

test('missing legacy credential starts retired and active state requires a real receipt', () => {
  const state = createLegacyCredentialRollbackState({
    journal: journal(),
    sourceReceipt: { present: false, bytes: 0, sha256: null },
    now: () => 1_700_000_000_000,
  });
  assert.equal(state.state, 'retired');
  assert.equal(state.retirementReason, 'no_legacy_credential');
  assert.throws(() => validateLegacyCredentialRollbackState({
    ...state,
    state: 'active',
    retiredAt: null,
    retirementReason: null,
  }), /active rollback/u);
});

test('unknown fields and unsafe binding changes fail closed', () => {
  const state = createLegacyCredentialRollbackState({
    journal: journal(), sourceReceipt: receipt(), now: () => 1_700_000_000_000,
  });
  assert.throws(() => validateLegacyCredentialRollbackState({ ...state, username: 'legacy-user' }),
    /schema/u);
  assert.throws(() => validateLegacyCredentialRollbackState({
    ...state,
    gatewayOrigin: 'http://remote.hkust-gz.edu.cn',
  }), /GatewayOrigin/u);
});
