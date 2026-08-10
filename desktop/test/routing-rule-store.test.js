'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_ROUTING_DOCUMENT_BYTES,
  MAX_ROUTING_RULES,
  deleteRoutingRule,
  loadRoutingRules,
  normalizeRoutingRules,
  normalizeRuleHost,
  saveRoutingRules,
  upsertRoutingRule,
} = require('../lib/routing-rule-store');

test('normalizes only exact host records and retains no URL material', () => {
  assert.equal(normalizeRuleHost(' Login.MicrosoftOnline.com. '), 'login.microsoftonline.com');
  assert.equal(normalizeRuleHost('例子.测试'), 'xn--fsqu00a.xn--0zwm56d');
  assert.equal(normalizeRuleHost('103.189.154.10'), '103.189.154.10');
  for (const invalid of [
    'https://login.microsoftonline.com/a?token=x',
    'user@example.com',
    '*.example.com',
    'example.com:443',
    'bad host.example',
    '.example.com',
    'example..com',
  ]) {
    assert.throws(() => normalizeRuleHost(invalid), /域名无效/);
  }
  assert.deepEqual(normalizeRoutingRules([
    { host: 'a.example', route: 'campus', includeSubdomains: false, updatedAt: 1 },
    { host: 'A.EXAMPLE.', route: 'direct', includeSubdomains: false, updatedAt: 2 },
    { host: 'invalid.example', route: 'unknown', includeSubdomains: false, updatedAt: 3 },
  ]), [{ host: 'a.example', route: 'direct', includeSubdomains: false, updatedAt: 2 }]);
});

test('rule loading rejects symlinks and oversized documents without following them', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-routes-bounds-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const oversized = path.join(directory, 'oversized.json');
  const target = path.join(directory, 'target.json');
  const link = path.join(directory, 'routing-rules.json');
  fs.writeFileSync(oversized, 'x'.repeat(MAX_ROUTING_DOCUMENT_BYTES + 1), { mode: 0o600 });
  fs.writeFileSync(target, JSON.stringify({
    version: 1,
    rules: [{
      host: 'secret.example', route: 'direct', includeSubdomains: false, updatedAt: 1,
    }],
  }), { mode: 0o600 });
  fs.symlinkSync(target, link);

  assert.deepEqual(loadRoutingRules(oversized), []);
  assert.deepEqual(loadRoutingRules(link), []);
  assert.match(fs.readFileSync(target, 'utf8'), /secret\.example/);
});

test('rule loading rejects hard links without changing the shared file', (t) => {
  if (process.platform === 'win32') return;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-routes-hardlink-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'unrelated.json');
  const link = path.join(directory, 'routing-rules.json');
  const source = JSON.stringify({
    version: 1,
    rules: [{ host: 'secret.example', route: 'direct', includeSubdomains: false, updatedAt: 1 }],
  });
  fs.writeFileSync(target, source, { mode: 0o600 });
  fs.linkSync(target, link);

  assert.deepEqual(loadRoutingRules(link), []);
  assert.equal(fs.readFileSync(target, 'utf8'), source);
});

test('transient routing-rule I/O errors propagate instead of authorizing overwrite', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-routes-io-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'routing-rules.json');
  saveRoutingRules(file, [{
    host: 'kept.example', route: 'direct', includeSubdomains: false, updatedAt: 1,
  }]);
  const originalOpen = fs.openSync;
  fs.openSync = (filePath, ...args) => {
    if (filePath === file) {
      const error = new Error('temporarily unavailable');
      error.code = 'EIO';
      throw error;
    }
    return originalOpen(filePath, ...args);
  };
  try {
    assert.throws(() => loadRoutingRules(file), (error) => error.code === 'EIO');
  } finally {
    fs.openSync = originalOpen;
  }
  assert.match(fs.readFileSync(file, 'utf8'), /kept\.example/);
});

test('persists a bounded v1 owner-only rule document and recovers from malformed JSON', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-routes-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'routing-rules.json');
  const oversized = Array.from({ length: MAX_ROUTING_RULES + 12 }, (_, index) => ({
    host: `host-${index}.example`,
    route: index % 2 ? 'direct' : 'campus',
    includeSubdomains: false,
    updatedAt: index,
  }));
  const saved = saveRoutingRules(file, oversized);
  assert.equal(saved.length, MAX_ROUTING_RULES);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(loadRoutingRules(file), saved);
  const serialized = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(serialized, /token|password|query/i);

  fs.writeFileSync(file, '{broken');
  assert.deepEqual(loadRoutingRules(file), []);
  fs.writeFileSync(file, JSON.stringify({ version: 999, rules: oversized }));
  assert.deepEqual(loadRoutingRules(file), []);
});

test('upsert and deletion use host plus scope as the stable identity', () => {
  const first = upsertRoutingRule([], {
    host: 'login.microsoftonline.com', route: 'direct',
  }, 10);
  const replaced = upsertRoutingRule(first.rules, {
    host: 'LOGIN.microsoftonline.com.', route: 'campus',
  }, 15);
  assert.equal(replaced.rules.length, 1);
  assert.equal(replaced.rule.route, 'campus');

  const next = upsertRoutingRule(replaced.rules, {
    host: 'login.microsoftonline.com', route: 'direct', includeSubdomains: true,
  }, 20);
  assert.equal(next.rules.length, 2);
  assert.equal(deleteRoutingRule(next.rules, 'login.microsoftonline.com', false).length, 1);
  assert.equal(deleteRoutingRule(next.rules, 'login.microsoftonline.com', true).length, 1);
});

test('direct rules cannot expose this computer or its surrounding private network', () => {
  for (const host of ['localhost', '127.0.0.1', '10.0.0.1', '100.64.0.1', '192.168.1.1', '::1']) {
    assert.throws(() => upsertRoutingRule([], {
      host, includeSubdomains: false, route: 'direct',
    }, 1), /不能设为直连|域名无效/, host);
  }
  assert.equal(upsertRoutingRule([], {
    host: '103.189.154.10', includeSubdomains: false, route: 'direct',
  }, 1).rule.route, 'direct');
  assert.equal(normalizeRoutingRules([{
    host: '192.168.1.1', includeSubdomains: false, route: 'direct', updatedAt: 1,
  }])[0].route, 'campus', 'legacy persisted rules migrate at the read boundary');
});

test('a routing-rule fsync failure cannot replace the previous JSON source of truth', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-routes-fsync-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'routing-rules.json');
  const previous = saveRoutingRules(file, [{
    host: 'old.example', route: 'campus', includeSubdomains: false, updatedAt: 1,
  }]);

  const originalFsync = fs.fsyncSync;
  let injected = false;
  fs.fsyncSync = (descriptor) => {
    if (!injected && fs.fstatSync(descriptor).isFile()) {
      injected = true;
      throw new Error('simulated rule fsync failure');
    }
    return originalFsync(descriptor);
  };
  try {
    assert.throws(() => saveRoutingRules(file, [{
      host: 'candidate.example', route: 'direct', includeSubdomains: false, updatedAt: 2,
    }]), /fsync failure/);
  } finally {
    fs.fsyncSync = originalFsync;
  }
  assert.deepEqual(loadRoutingRules(file), previous);
  assert.equal(fs.readdirSync(directory).some((entry) => entry.endsWith('.tmp')), false);
});

test('a post-rename rule directory-fsync failure is marked for transaction rollback', {
  skip: process.platform === 'win32',
}, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-routes-dir-fsync-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'routing-rules.json');
  const originalFsync = fs.fsyncSync;
  fs.fsyncSync = (descriptor) => {
    if (fs.fstatSync(descriptor).isDirectory()) throw new Error('directory fsync failed');
    return originalFsync(descriptor);
  };
  try {
    assert.throws(() => saveRoutingRules(file, [{
      host: 'candidate.example', route: 'direct', includeSubdomains: false, updatedAt: 2,
    }]), (error) => error.commitApplied === true);
  } finally {
    fs.fsyncSync = originalFsync;
  }
  assert.equal(loadRoutingRules(file)[0].host, 'candidate.example');
});
