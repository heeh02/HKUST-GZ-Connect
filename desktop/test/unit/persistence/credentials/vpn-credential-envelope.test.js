'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  decryptVpnCredentialEnvelope,
  encryptVpnCredentialEnvelope,
} = require('../../../../lib/persistence/credentials/vpn-credential-envelope');

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString(value) {
      return Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5);
    },
    decryptString(value) {
      return Buffer.from(value).map((byte) => byte ^ 0xa5).toString('utf8');
    },
  };
}

function binding(overrides = {}) {
  return {
    profileId: 'hkustgz',
    profileCredentialBindingRevision: 1,
    accountKey: `account-${'22'.repeat(16)}`,
    accountCredentialRevision: 1,
    gatewayOrigin: 'https://remote.hkust-gz.edu.cn',
    protocolFamily: 'easyconnect-password-modern-l3-v1',
    ...overrides,
  };
}

test('username and password commit as one encrypted profile/account-bound envelope', () => {
  const safeStorage = fakeSafeStorage();
  const encrypted = encryptVpnCredentialEnvelope({
    binding: binding(),
    credentialVersion: 1,
    username: 'legacy-user',
    password: 'private-password',
    updatedAt: 1_700_000_000_000,
    safeStorage,
    platform: 'darwin',
  });
  assert.equal(Buffer.isBuffer(encrypted), true);
  assert.equal(encrypted.includes(Buffer.from('legacy-user')), false);
  assert.equal(encrypted.includes(Buffer.from('private-password')), false);

  const decrypted = decryptVpnCredentialEnvelope(encrypted, {
    expectedBinding: binding(),
    safeStorage,
    platform: 'darwin',
  });
  assert.equal(decrypted.credentialVersion, 1);
  assert.equal(Object.isFrozen(decrypted), true);
  assert.equal(decrypted.withStrings((username, password) => (
    `${username}:${password}`
  )), 'legacy-user:private-password');
  assert.equal(decrypted.withUsername((username) => username), 'legacy-user');
  assert.equal(JSON.stringify(decrypted), '"[redacted vpn credential]"');
  assert.equal(String(decrypted).includes('legacy-user'), false);
  assert.equal(decrypted.destroy(), true);
  assert.equal(decrypted.destroy(), false);
  assert.throws(() => decrypted.withStrings(() => true), /destroyed/u);
  assert.throws(() => decrypted.withUsername(() => true), /destroyed/u);
});

test('binding mismatch fails before returning a credential owner', () => {
  const safeStorage = fakeSafeStorage();
  const encrypted = encryptVpnCredentialEnvelope({
    binding: binding(),
    credentialVersion: 1,
    username: 'legacy-user',
    password: 'private-password',
    updatedAt: 1_700_000_000_000,
    safeStorage,
    platform: 'darwin',
  });
  for (const expectedBinding of [
    binding({ accountKey: `account-${'33'.repeat(16)}` }),
    binding({ accountCredentialRevision: 2 }),
    binding({ gatewayOrigin: 'https://other.example.edu' }),
  ]) {
    assert.throws(() => decryptVpnCredentialEnvelope(encrypted, {
      expectedBinding,
      safeStorage,
      platform: 'darwin',
    }), /binding/u);
  }
});

test('envelope schema rejects controls, unknown fields and unsupported plaintext storage', () => {
  const safeStorage = fakeSafeStorage();
  const base = {
    binding: binding(),
    credentialVersion: 1,
    username: 'legacy-user',
    password: 'private-password',
    updatedAt: 1_700_000_000_000,
    safeStorage,
    platform: 'darwin',
  };
  assert.throws(() => encryptVpnCredentialEnvelope({ ...base, username: 'bad\nuser' }),
    /credential/u);
  assert.throws(() => encryptVpnCredentialEnvelope({ ...base, password: '' }),
    /credential/u);
  assert.throws(() => encryptVpnCredentialEnvelope({
    ...base,
    platform: 'linux',
    safeStorage: { ...safeStorage, getSelectedStorageBackend: () => 'basic_text' },
  }), /protected storage/u);
  assert.throws(() => encryptVpnCredentialEnvelope({
    ...base,
    platform: 'linux',
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: safeStorage.encryptString,
      decryptString: safeStorage.decryptString,
    },
  }), /protected storage/u);

  const unknown = safeStorage.encryptString(JSON.stringify({
    schemaVersion: 1,
    ...binding(),
    credentialVersion: 1,
    username: 'legacy-user',
    password: 'private-password',
    updatedAt: 1_700_000_000_000,
    otp: 'not-allowed',
  }));
  assert.throws(() => decryptVpnCredentialEnvelope(unknown, {
    expectedBinding: binding(), safeStorage, platform: 'darwin',
  }), /schema/u);
});
