'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildClashProxyYaml,
  buildSshProxyCommand,
  ensureProxyCredentialSidecar,
  externalProxyHelperPath,
  helperExecutableName,
} = require('../lib/external-proxy-config');

const material = Object.freeze({
  username: 'A'.repeat(32),
  password: 'B'.repeat(32),
});
const credential = {
  withStrings(callback) {
    return callback(material.username, material.password);
  },
};

test('Clash node is valid bounded YAML with strict credentials and UDP disabled', () => {
  const yaml = buildClashProxyYaml({ port: 6180, credential });
  assert.match(yaml, /^proxies:\n/);
  assert.match(yaml, /name: "HKUST\(GZ\) Connect"/);
  assert.match(yaml, /type: "socks5"/);
  assert.match(yaml, /server: "127\.0\.0\.1"/);
  assert.match(yaml, /port: 6180/);
  assert.match(yaml, new RegExp(`username: ${JSON.stringify(material.username)}`));
  assert.match(yaml, new RegExp(`password: ${JSON.stringify(material.password)}`));
  assert.match(yaml, /udp: false\n$/);

  const compatibility = buildClashProxyYaml({ port: 6180 });
  assert.doesNotMatch(compatibility, /username:|password:/);
  assert.match(compatibility, /udp: false/);
});

test('helper sidecar is owner-only, exactly three lines, and not rewritten when unchanged', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-proxy-sidecar-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'proxy-helper-credential.txt');
  const first = ensureProxyCredentialSidecar({ filePath, port: 6180, credential });
  assert.equal(first.changed, true);
  const stat = fs.statSync(filePath);
  assert.equal(stat.mode & 0o077, 0);
  assert.deepEqual(fs.readFileSync(filePath, 'utf8').split('\n'), [
    '127.0.0.1:6180',
    material.username,
    material.password,
  ]);

  const second = ensureProxyCredentialSidecar({ filePath, port: 6180, credential });
  assert.equal(second.changed, false);
  assert.equal(fs.statSync(filePath).ino, stat.ino, 'unchanged sidecar keeps its inode');

  const changed = ensureProxyCredentialSidecar({ filePath, port: 6280, credential });
  assert.equal(changed.changed, true);
  assert.equal(fs.readFileSync(filePath, 'utf8').split('\n')[0], '127.0.0.1:6280');
});

test('Windows sidecar is ACL-protected before commit and reverified when unchanged', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-proxy-sidecar-win-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'proxy-helper-credential.txt');
  const calls = [];
  const windowsAcl = {
    protect: (file) => { calls.push(['protect', file]); return true; },
    verify: (file) => { calls.push(['verify', file]); return true; },
  };
  const first = ensureProxyCredentialSidecar({
    filePath, port: 6180, credential, platform: 'win32', windowsAcl,
  });
  assert.equal(first.changed, true);
  assert.match(path.basename(calls[0][1]), /^\.proxy-helper-credential\.txt\..+\.tmp$/u);
  assert.deepEqual(calls[1], ['verify', filePath]);

  calls.length = 0;
  const second = ensureProxyCredentialSidecar({
    filePath, port: 6180, credential, platform: 'win32', windowsAcl,
  });
  assert.equal(second.changed, false);
  assert.deepEqual(calls, [['protect', filePath], ['verify', filePath]]);
});

test('Windows sidecar protection or verification failure removes untrusted plaintext', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-proxy-sidecar-fail-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'proxy-helper-credential.txt');

  assert.throws(() => ensureProxyCredentialSidecar({
    filePath,
    port: 6180,
    credential,
    platform: 'win32',
    windowsAcl: { protect: () => false, verify: () => true },
  }), /could not write/u);
  assert.equal(fs.existsSync(filePath), false);

  assert.throws(() => ensureProxyCredentialSidecar({
    filePath,
    port: 6180,
    credential,
    platform: 'win32',
    windowsAcl: { protect: () => true, verify: () => false },
  }), /could not write/u);
  assert.equal(fs.existsSync(filePath), false);

  fs.writeFileSync(filePath, `127.0.0.1:6180\n${material.username}\n${material.password}`);
  assert.throws(() => ensureProxyCredentialSidecar({
    filePath,
    port: 6180,
    credential,
    platform: 'win32',
    windowsAcl: { protect: () => true, verify: () => false },
  }), /verify/u);
  assert.equal(fs.existsSync(filePath), false);
});

test('one SSH ProxyCommand contains only stable paths and targets the packaged helper', () => {
  assert.equal(helperExecutableName('darwin', 'arm64'), 'ec-proxy-command-darwin-arm64');
  assert.equal(helperExecutableName('win32', 'x64'), 'ec-proxy-command-windows-amd64.exe');
  const helperPath = externalProxyHelperPath({
    isPackaged: true,
    resourcesPath: '/Applications/HKUST(GZ) Connect.app/Contents/Resources',
    desktopDir: '/unused',
    platform: 'darwin',
    arch: 'arm64',
  });
  const config = buildSshProxyCommand({
    helperPath,
    credentialFile: '/Users/student/Library/Application Support/HKUST/proxy-helper-credential.txt',
  });
  assert.match(config, /ec-proxy-command-darwin-arm64" --credential-file/);
  assert.match(config, /-- %h %p$/);
  assert.doesNotMatch(config, new RegExp(material.username));
  assert.doesNotMatch(config, new RegExp(material.password));
  assert.doesNotMatch(config, /\bnc\b|connect\.exe/);
});
