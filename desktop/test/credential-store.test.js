'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  clearPasswordSnapshot,
  credentialLoadErrorKey,
  hasStoredPassword,
  loadPassword,
  loadPasswordResult,
  restorePasswordSnapshot,
  savePassword,
  snapshotPasswordFile,
} = require('../lib/credential-store');

const HOST_PRIVATE_FILE_PLATFORM = process.platform === 'win32' ? 'win32' : 'darwin';

test('password presence is a non-decrypting private-file check', {
  skip: process.platform === 'win32',
}, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-credential-presence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const missing = path.join(directory, 'missing.bin');
  const empty = path.join(directory, 'empty.bin');
  const privateFile = path.join(directory, 'cred.bin');

  assert.equal(hasStoredPassword(missing, 'darwin'), false);
  fs.writeFileSync(empty, '');
  assert.equal(hasStoredPassword(empty, 'darwin'), false);
  assert.equal(hasStoredPassword(directory, 'darwin'), false);

  fs.writeFileSync(privateFile, Buffer.from([1]));
  fs.chmodSync(privateFile, 0o600);
  assert.equal(hasStoredPassword(privateFile, 'darwin'), true);

  fs.chmodSync(privateFile, 0o644);
  assert.equal(hasStoredPassword(privateFile, 'darwin'), false);
});

test('Windows presence check accepts the platform ACL model without safeStorage', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-credential-windows-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'cred.bin');
  fs.writeFileSync(file, Buffer.from([1]));
  fs.chmodSync(file, 0o644);

  assert.equal(hasStoredPassword(file, 'win32'), true);
});

test('oversized and symbolic credential blobs are rejected before decryption', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-credential-bounds-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const oversized = path.join(directory, 'oversized.bin');
  const target = path.join(directory, 'target.bin');
  const link = path.join(directory, 'link.bin');
  fs.writeFileSync(oversized, Buffer.alloc(64 * 1024 + 1), { mode: 0o600 });
  fs.writeFileSync(target, Buffer.from('encrypted'), { mode: 0o600 });
  fs.symlinkSync(target, link);
  let decryptions = 0;
  const safeStorage = {
    isEncryptionAvailable: () => true,
    decryptString: () => { decryptions++; return 'secret'; },
  };

  assert.equal(hasStoredPassword(oversized, 'darwin'), false);
  assert.equal(hasStoredPassword(link, 'darwin'), false);
  assert.equal(loadPassword(oversized, safeStorage, 'darwin'), '');
  assert.equal(loadPassword(link, safeStorage, 'darwin'), '');
  assert.equal(decryptions, 0);
  assert.equal(loadPasswordResult(oversized, safeStorage, 'darwin').status, 'corrupt');
  assert.equal(loadPasswordResult(link, safeStorage, 'darwin').status, 'corrupt');
});

test('credential loading distinguishes missing, unavailable, corrupt and decrypt failure', {
  skip: process.platform === 'win32',
}, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-credential-result-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const missing = path.join(directory, 'missing.bin');
  const file = path.join(directory, 'credential.bin');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    decryptString: (data) => data.toString('utf8').replace('encrypted:', ''),
  };

  assert.deepEqual(loadPasswordResult(missing, safeStorage, 'darwin'), {
    status: 'missing', password: '',
  });
  assert.deepEqual(loadPasswordResult(missing, {
    isEncryptionAvailable: () => false,
  }, 'darwin'), { status: 'unavailable', password: '' });

  fs.writeFileSync(file, Buffer.from('encrypted:secret'), { mode: 0o644 });
  assert.deepEqual(loadPasswordResult(file, safeStorage, 'darwin'), {
    status: 'corrupt', password: '',
  });
  fs.chmodSync(file, 0o600);
  assert.deepEqual(loadPasswordResult(file, safeStorage, 'darwin'), {
    status: 'decrypted', password: 'secret',
  });
  assert.deepEqual(loadPasswordResult(file, {
    isEncryptionAvailable: () => true,
    decryptString: () => { throw new Error('fixture denied'); },
  }, 'darwin'), { status: 'decrypt_failed', password: '' });
  assert.equal(credentialLoadErrorKey('corrupt'), 'error.credentialStoreCorrupt');
  assert.equal(credentialLoadErrorKey('decrypt_failed'), 'error.credentialDecryptFailed');
  assert.equal(credentialLoadErrorKey('unavailable'), 'error.credentialStoreUnavailable');
});

test('main VPN credential replacement is atomic and preserves the old blob on failure', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-credential-atomic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'credential.bin');
  fs.writeFileSync(file, Buffer.from('encrypted:old-secret'), { mode: 0o600 });
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
  };
  const failingFileSystem = Object.create(fs);
  failingFileSystem.renameSync = () => { throw new Error('simulated commit failure'); };

  assert.equal(savePassword(
    file, 'new-secret', safeStorage, HOST_PRIVATE_FILE_PLATFORM, failingFileSystem,
  ), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'encrypted:old-secret');
  assert.deepEqual(
    fs.readdirSync(directory).filter((entry) => entry.endsWith('.tmp')),
    [],
  );

  assert.equal(savePassword(file, 'new-secret', safeStorage, HOST_PRIVATE_FILE_PLATFORM), true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'encrypted:new-secret');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('encryption failure never truncates an existing VPN credential', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-credential-encrypt-fail-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'credential.bin');
  fs.writeFileSync(file, Buffer.from('encrypted:old-secret'), { mode: 0o600 });
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: () => { throw new Error('keychain unavailable'); },
  };

  assert.equal(savePassword(file, 'new-secret', safeStorage, 'darwin'), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'encrypted:old-secret');
});

test('credential replacement reports a post-rename directory-fsync failure', {
  skip: process.platform === 'win32',
}, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-credential-fsync-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'credential.bin');
  fs.writeFileSync(file, Buffer.from('encrypted:old-secret'), { mode: 0o600 });
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
  };
  const failingFileSystem = Object.create(fs);
  let fsyncCalls = 0;
  failingFileSystem.fsyncSync = (descriptor) => {
    fsyncCalls++;
    if (fsyncCalls === 2) throw new Error('simulated directory fsync failure');
    return fs.fsyncSync(descriptor);
  };

  assert.equal(
    savePassword(file, 'new-secret', safeStorage, 'darwin', failingFileSystem),
    false,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'encrypted:new-secret',
    'the journal-owning caller must roll back a rename whose durability was not confirmed');
});

test('a settings transaction can restore and erase its encrypted password snapshot', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-credential-rollback-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'credential.bin');
  fs.writeFileSync(file, Buffer.from('encrypted:old-secret'), { mode: 0o600 });
  const snapshot = snapshotPasswordFile(file);
  assert.equal(snapshot.existed, true);
  fs.writeFileSync(file, Buffer.from('encrypted:new-secret'), { mode: 0o600 });
  assert.equal(restorePasswordSnapshot(file, snapshot), true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'encrypted:old-secret');
  clearPasswordSnapshot(snapshot);
  assert.equal(snapshot.data.every((byte) => byte === 0), true);

  const missing = path.join(directory, 'new-credential.bin');
  const absent = snapshotPasswordFile(missing);
  fs.writeFileSync(missing, Buffer.from('encrypted:new-secret'), { mode: 0o600 });
  assert.equal(restorePasswordSnapshot(missing, absent), true);
  assert.equal(fs.existsSync(missing), false);
});
