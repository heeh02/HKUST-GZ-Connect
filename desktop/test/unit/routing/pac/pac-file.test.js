'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MAX_PAC_BYTES, savePacFile } = require('../../../../lib/routing/pac/pac-file');

test('PAC files are atomically owner-only and carry a content revision URL', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-pac-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'browser-routing.pac');
  const first = savePacFile(file, 'function FindProxyForURL(){return "DIRECT";}');
  const second = savePacFile(file, 'function FindProxyForURL(){return "SOCKS5 127.0.0.1:6180";}');
  assert.notEqual(first.revision, second.revision);
  assert.match(second.url, /^file:.*\?v=[a-f0-9]{16}$/);
  assert.match(fs.readFileSync(file, 'utf8'), /6180/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readdirSync(directory).some((entry) => entry.endsWith('.tmp')), false);
});

test('PAC writes reject empty and unbounded content without replacing a valid file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-pac-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'routing.pac');
  savePacFile(file, 'valid');
  assert.throws(() => savePacFile(file, ''), /无效/);
  assert.throws(() => savePacFile(file, 'x'.repeat(MAX_PAC_BYTES + 1)), /无效/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'valid');
});

test('a PAC fsync failure cannot replace the previously committed policy', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-pac-fsync-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'routing.pac');
  savePacFile(file, 'old-policy');

  const originalFsync = fs.fsyncSync;
  let injected = false;
  fs.fsyncSync = (descriptor) => {
    if (!injected && fs.fstatSync(descriptor).isFile()) {
      injected = true;
      throw new Error('simulated file fsync failure');
    }
    return originalFsync(descriptor);
  };
  try {
    assert.throws(() => savePacFile(file, 'candidate-policy'), /fsync failure/);
  } finally {
    fs.fsyncSync = originalFsync;
  }
  assert.equal(fs.readFileSync(file, 'utf8'), 'old-policy');
  assert.equal(fs.readdirSync(directory).some((entry) => entry.endsWith('.tmp')), false);
});

test('a post-rename PAC directory-fsync failure exposes its commit point', {
  skip: process.platform === 'win32',
}, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-pac-dir-fsync-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'routing.pac');
  const originalFsync = fs.fsyncSync;
  fs.fsyncSync = (descriptor) => {
    if (fs.fstatSync(descriptor).isDirectory()) throw new Error('directory fsync failed');
    return originalFsync(descriptor);
  };
  try {
    assert.throws(() => savePacFile(file, 'candidate-policy'), (error) => (
      error.commitApplied === true && /directory fsync/.test(error.message)
    ));
  } finally {
    fs.fsyncSync = originalFsync;
  }
  assert.equal(fs.readFileSync(file, 'utf8'), 'candidate-policy');
});
