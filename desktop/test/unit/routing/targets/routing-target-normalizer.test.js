'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeRoutingTarget,
} = require('../../../../lib/routing/rules/routing-rule-store');

test('routing target accepts a full web URL or host and stores only its canonical host', () => {
  assert.deepEqual(normalizeRoutingTarget(
    'https://hpc2login.hpc.hkust-gz.edu.cn/login?next=%2Fhome#top',
  ), {
    host: 'hpc2login.hpc.hkust-gz.edu.cn',
    inputKind: 'url',
    discardedPort: false,
    discardedPath: true,
  });
  assert.equal(normalizeRoutingTarget(' Login.Example.Test. ').host, 'login.example.test');
  assert.equal(normalizeRoutingTarget('example.test:8443/path').host, 'example.test');
  assert.equal(normalizeRoutingTarget('intranet:8443/path').host, 'intranet');
  assert.equal(normalizeRoutingTarget('https://例子.测试/').host, 'xn--fsqu00a.xn--0zwm56d');
  assert.equal(normalizeRoutingTarget('192.0.2.10').host, '192.0.2.10');
});

test('routing target rejects credentials, non-web protocols, wildcards and malformed values', () => {
  for (const value of [
    '', 'javascript:alert(1)', 'file:///tmp/x', 'ftp://example.test/',
    'https://user:secret@example.test/', '*.example.test', 'a..b',
    'https://[2001:db8::1]/', 'example test', 'https://example.test/\nnext',
  ]) assert.throws(() => normalizeRoutingTarget(value), { code: 'ROUTING_TARGET_INVALID' });
});
