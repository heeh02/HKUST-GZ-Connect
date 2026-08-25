'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  VpnCredentialEnvelopeStore,
} = require('../lib/vpn-credential-envelope-store');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-vpn-envelope-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, 'account', 'vpn-credential.bin') };
}

test('encrypted envelope store saves, loads and durably removes one owner-only blob', (t) => {
  const { file } = fixture(t);
  const store = new VpnCredentialEnvelopeStore({ filePath: file });
  const encrypted = Buffer.from('synthetic-encrypted-envelope');

  assert.equal(store.load(), null);
  assert.equal(store.save(encrypted), true);
  assert.deepEqual(store.load(), encrypted);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(store.remove(), true);
  assert.equal(store.load(), null);
  assert.equal(store.remove(), false);
});

test('failed atomic replacement preserves the previous encrypted envelope', (t) => {
  const { file } = fixture(t);
  const original = Buffer.from('old-encrypted-envelope');
  const base = new VpnCredentialEnvelopeStore({ filePath: file });
  base.save(original);
  const injected = Object.create(fs);
  injected.renameSync = () => { throw new Error('simulated rename failure'); };
  const store = new VpnCredentialEnvelopeStore({ filePath: file, fileSystem: injected });

  assert.throws(() => store.save(Buffer.from('new-encrypted-envelope')), /save failed/u);
  assert.deepEqual(base.load(), original);
});

test('post-rename directory fsync failure reports that the new envelope became visible', {
  skip: process.platform === 'win32',
}, (t) => {
  const { file } = fixture(t);
  const injected = Object.create(fs);
  let fsyncs = 0;
  injected.fsyncSync = (descriptor) => {
    if (++fsyncs === 2) throw new Error('simulated directory fsync failure');
    return fs.fsyncSync(descriptor);
  };
  const store = new VpnCredentialEnvelopeStore({ filePath: file, fileSystem: injected });
  const next = Buffer.from('new-encrypted-envelope');
  assert.throws(() => store.save(next), (error) => (
    /save failed/u.test(error.message) && error.commitApplied === true
  ));
  assert.deepEqual(new VpnCredentialEnvelopeStore({ filePath: file }).load(), next);
});

test('envelope store rejects links and broad POSIX permissions', {
  skip: process.platform === 'win32',
}, (t) => {
  const { directory, file } = fixture(t);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const unrelated = path.join(directory, 'unrelated.bin');
  fs.writeFileSync(unrelated, 'encrypted', { mode: 0o600 });
  fs.symlinkSync(unrelated, file);
  assert.throws(() => new VpnCredentialEnvelopeStore({ filePath: file }).load(), /private file/u);
  fs.unlinkSync(file);
  fs.linkSync(unrelated, file);
  assert.throws(() => new VpnCredentialEnvelopeStore({ filePath: file }).load(), /private file/u);
  fs.unlinkSync(file);
  fs.copyFileSync(unrelated, file);
  fs.chmodSync(file, 0o644);
  assert.throws(() => new VpnCredentialEnvelopeStore({ filePath: file }).load(), /private file/u);
});

test('observed encrypted envelope disappearance fails closed', (t) => {
  const { file } = fixture(t);
  const base = new VpnCredentialEnvelopeStore({ filePath: file });
  base.save(Buffer.from('encrypted'));
  const injected = Object.create(fs);
  let stats = 0;
  injected.lstatSync = (value, ...args) => {
    if (value === file && ++stats === 2) {
      fs.unlinkSync(file);
      const error = new Error('disappeared');
      error.code = 'ENOENT';
      throw error;
    }
    return fs.lstatSync(value, ...args);
  };
  const store = new VpnCredentialEnvelopeStore({ filePath: file, fileSystem: injected });
  assert.throws(() => store.load(), /disappeared/u);
});

test('simulated Windows envelope storage protects and verifies ACLs', (t) => {
  const { file } = fixture(t);
  const protectedPaths = [];
  const verifiedPaths = [];
  const windowsAcl = {
    protect(value) { protectedPaths.push(value); return true; },
    verify(value) { verifiedPaths.push(value); return fs.existsSync(value); },
  };
  const store = new VpnCredentialEnvelopeStore({
    filePath: file,
    platform: 'win32',
    windowsAcl,
  });
  assert.equal(store.load(), null);
  assert.equal(verifiedPaths.length, 0);
  store.save(Buffer.from('encrypted'));
  assert.deepEqual(store.load(), Buffer.from('encrypted'));
  assert.equal(protectedPaths.some((value) => value.endsWith('.tmp')), true);
  assert.equal(verifiedPaths.includes(file), true);
});
