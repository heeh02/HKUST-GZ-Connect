'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  PRIVATE_FILE_ENV,
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('../lib/windows-private-file');

test('Windows ACL commands keep paths out of scripts and require fixed verification output', () => {
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    return 'owner_only';
  };
  const file = String.raw`C:\Users\student\private credential.txt`;
  assert.equal(protectWindowsFileOwnerOnly(file, {
    execute,
    environment: { SystemRoot: String.raw`C:\Windows` },
    platform: 'win32',
  }), true);
  assert.equal(verifyWindowsFileOwnerOnly(file, {
    execute,
    environment: {},
    platform: 'win32',
  }), true);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.command, 'powershell.exe');
    assert.equal(call.args.includes(file), false, 'the path is not interpolated into PowerShell');
    assert.equal(call.options.env[PRIVATE_FILE_ENV], file);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.maxBuffer, 4096);
    assert.equal(call.options.timeout, 5000);
  }

  assert.equal(verifyWindowsFileOwnerOnly(file, {
    execute: () => 'unexpected', platform: 'win32',
  }), false);
  assert.equal(protectWindowsFileOwnerOnly(file, {
    execute: () => { throw new Error('synthetic failure'); }, platform: 'win32',
  }), false);
  assert.equal(protectWindowsFileOwnerOnly('relative.txt', { execute, platform: 'win32' }), false);
  assert.equal(protectWindowsFileOwnerOnly(file, { execute, platform: 'darwin' }), false);
});

test('real Windows ACL is current-user-only and inheritance-protected', {
  skip: process.platform !== 'win32',
}, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-windows-acl-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'proxy-helper-credential.txt');
  fs.writeFileSync(file, 'synthetic-sidecar');
  assert.equal(protectWindowsFileOwnerOnly(file), true);
  assert.equal(verifyWindowsFileOwnerOnly(file), true);
});
