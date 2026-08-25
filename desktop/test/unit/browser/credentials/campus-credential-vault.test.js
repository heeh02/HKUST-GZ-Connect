'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CampusCredentialVault,
  MAX_VAULT_DOCUMENT_BYTES,
  normalizeCredentialOrigin,
} = require('../../../../lib/browser/credentials/campus-credential-vault');

const HOST_PRIVATE_FILE_PLATFORM = process.platform === 'win32' ? 'win32' : 'darwin';

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

test('credential vault stores only encrypted local payloads and supports removal', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-vault-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'campus-credentials.json');
  const vault = new CampusCredentialVault({
    filePath,
    safeStorage: fakeSafeStorage(),
    platform: HOST_PRIVATE_FILE_PLATFORM,
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
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o077, 0);
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

test('credential vault rejects oversized, non-private, and non-canonical documents', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-vault-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'campus-credentials.json');
  const vault = new CampusCredentialVault({
    filePath,
    safeStorage: fakeSafeStorage(),
    platform: HOST_PRIVATE_FILE_PLATFORM,
  });
  fs.writeFileSync(filePath, 'x'.repeat(MAX_VAULT_DOCUMENT_BYTES + 1), { mode: 0o600 });
  await assert.rejects(() => vault.count(), /vault file/);
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, ciphertext: '!!!!' }), { mode: 0o600 });
  await assert.rejects(() => vault.count(), /unsupported/);
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o644);
    await assert.rejects(() => vault.count(), /vault file/);
  }
});

test('credential vault never follows a symlink or overwrites on transient read failure', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-vault-io-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'unrelated.json');
  const link = path.join(directory, 'campus-credentials.json');
  fs.writeFileSync(target, JSON.stringify({ version: 1, ciphertext: 'c2VjcmV0' }), { mode: 0o600 });
  fs.symlinkSync(target, link);
  const vault = new CampusCredentialVault({
    filePath: link,
    safeStorage: fakeSafeStorage(),
    platform: HOST_PRIVATE_FILE_PLATFORM,
  });
  await assert.rejects(() => vault.count(), /vault file/);
  assert.match(fs.readFileSync(target, 'utf8'), /c2VjcmV0/);

  fs.unlinkSync(link);
  fs.writeFileSync(link, JSON.stringify({ version: 1, ciphertext: 'c2VjcmV0' }), { mode: 0o600 });
  const originalLstat = fs.lstatSync;
  fs.lstatSync = (filePath, ...args) => {
    if (filePath === link) {
      const error = new Error('temporarily unavailable');
      error.code = 'EIO';
      throw error;
    }
    return originalLstat(filePath, ...args);
  };
  try {
    await assert.rejects(
      () => vault.save('https://new.example', 'new-user', 'new-password'),
      (error) => error.code === 'EIO',
    );
  } finally {
    fs.lstatSync = originalLstat;
  }
  assert.match(fs.readFileSync(link, 'utf8'), /c2VjcmV0/);
});

test('credential vault rejects hard links without changing the shared file', async (t) => {
  if (process.platform === 'win32') return;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-vault-hardlink-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'unrelated.json');
  const link = path.join(directory, 'campus-credentials.json');
  fs.writeFileSync(target, JSON.stringify({ version: 1, ciphertext: 'c2VjcmV0' }), { mode: 0o600 });
  fs.linkSync(target, link);
  const before = fs.readFileSync(target, 'utf8');
  const vault = new CampusCredentialVault({
    filePath: link,
    safeStorage: fakeSafeStorage(),
    platform: HOST_PRIVATE_FILE_PLATFORM,
  });

  await assert.rejects(() => vault.count(), /vault file/);
  assert.equal(fs.readFileSync(target, 'utf8'), before);
});

test('a post-rename directory-fsync failure keeps the committed encrypted vault visible', {
  skip: process.platform === 'win32',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-vault-fsync-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'campus-credentials.json');
  const warnings = [];
  const vault = new CampusCredentialVault({
    filePath,
    safeStorage: fakeSafeStorage(),
    platform: HOST_PRIVATE_FILE_PLATFORM,
    onDurabilityWarning: (error) => warnings.push(error),
  });
  const originalFsync = fs.fsyncSync;
  let fsyncCalls = 0;
  fs.fsyncSync = (descriptor) => {
    fsyncCalls += 1;
    if (fsyncCalls === 2) {
      const error = new Error('simulated directory fsync failure');
      error.code = 'EIO';
      throw error;
    }
    return originalFsync(descriptor);
  };
  try {
    await vault.save('https://sso.example.edu', 'student001', 'local-secret');
  } finally {
    fs.fsyncSync = originalFsync;
  }

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].commitApplied, true);
  assert.equal(vault.lastDurabilityError, warnings[0]);
  assert.equal((await vault.get('https://sso.example.edu')).username, 'student001');
});
