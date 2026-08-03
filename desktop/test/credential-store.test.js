'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { hasStoredPassword } = require('../lib/credential-store');

test('password presence is a non-decrypting private-file check', (t) => {
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
