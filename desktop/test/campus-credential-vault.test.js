'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CampusCredentialVault,
  normalizeCredentialOrigin,
} = require('../lib/campus-credential-vault');

function fakeSafeStorage() {
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) =>
      Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
    decryptStringAsync: async (value) => ({
      result: Buffer.from(
        value.toString().replace(/^encrypted:/, ''),
        'base64',
      ).toString(),
      shouldReEncrypt: false,
    }),
  };
}

test('site credentials are scoped to an exact HTTPS origin', () => {
  assert.equal(normalizeCredentialOrigin('https://sso.example.edu/login'), 'https://sso.example.edu');
  assert.throws(() => normalizeCredentialOrigin('http://sso.example.edu'), /HTTPS/);
  assert.throws(() => normalizeCredentialOrigin('https://u:p@sso.example.edu'), /HTTPS/);
});

test('credential vault stores only encrypted local payloads and supports removal', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-vault-'));
  const filePath = path.join(directory, 'campus-credentials.json');
  const vault = new CampusCredentialVault({
    filePath,
    safeStorage: fakeSafeStorage(),
    platform: 'darwin',
  });
  await vault.save('https://sso.example.edu/login', 'student001', 'local-secret');
  const disk = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(disk, /student001|local-secret/);
  assert.deepEqual(
    await vault.get('https://sso.example.edu/other'),
    {
      origin: 'https://sso.example.edu',
      username: 'student001',
      password: 'local-secret',
      updatedAt: (await vault.get('https://sso.example.edu')).updatedAt,
    },
  );
  assert.equal(await vault.count(), 1);
  assert.equal(await vault.remove('https://sso.example.edu'), true);
  assert.equal(await vault.get('https://sso.example.edu'), null);
});

test('credential vault refuses Linux plaintext fallback', async () => {
  const safeStorage = fakeSafeStorage();
  safeStorage.getSelectedStorageBackend = () => 'basic_text';
  const vault = new CampusCredentialVault({
    filePath: '/unused',
    safeStorage,
    platform: 'linux',
  });
  assert.equal(await vault.available(), false);
});
