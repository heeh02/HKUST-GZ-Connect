'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { buildPac, normalizeRouteDomains } = require('../../../../lib/routing/pac/pac');

test('route domains are normalized, deduplicated, and bounded', () => {
  assert.deepEqual(
    normalizeRouteDomains('*.HKUST-GZ.EDU.CN\n.hkust.edu.hk;bad/domain\nhkust.edu.hk'),
    ['hkust-gz.edu.cn', 'hkust.edu.hk'],
  );
  assert.equal(normalizeRouteDomains(Array(100).fill('example.com')).length, 1);
  assert.deepEqual(normalizeRouteDomains(undefined, ['Campus.Example.EDU']), [
    'campus.example.edu',
  ]);
  assert.deepEqual(normalizeRouteDomains([], []), [],
    'a custom Profile with no reviewed domains must not inherit another school');
});

test('PAC routes only explicit suffixes and literal private addresses', () => {
  const source = buildPac(['hkust-gz.edu.cn'], 6180);
  assert.doesNotMatch(source, /dnsResolve|isInNet|PROXY /);
  assert.match(source, /SOCKS5 127\.0\.0\.1:6180/);
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(
    context.FindProxyForURL('https://www.hkust-gz.edu.cn/', 'www.hkust-gz.edu.cn'),
    'SOCKS5 127.0.0.1:6180',
  );
  assert.equal(
    context.FindProxyForURL('https://hkust-gz.edu.cn/', 'hkust-gz.edu.cn'),
    'SOCKS5 127.0.0.1:6180',
  );
  assert.equal(
    context.FindProxyForURL('https://not-hkust-gz.edu.cn/', 'not-hkust-gz.edu.cn'),
    'DIRECT',
  );
  assert.equal(context.FindProxyForURL('http://10.120.48.30/', '10.120.48.30'), 'SOCKS5 127.0.0.1:6180');
  assert.equal(context.FindProxyForURL('http://127.0.0.1/', '127.0.0.1'), 'SOCKS5 127.0.0.1:6180');
  assert.equal(context.FindProxyForURL('http://192.168.1.1/', '192.168.1.1'), 'SOCKS5 127.0.0.1:6180');
  assert.equal(context.FindProxyForURL('https://example.com/', 'example.com'), 'DIRECT');
});

test('custom Profile PAC does not inherit HKUST domains from an empty authority', () => {
  const source = buildPac([], 6180, { schoolDomains: [], directPartnerDomains: [] });
  assert.equal(source.includes('hkust-gz.edu.cn'), false);
  assert.equal(source.includes('hkust.edu.hk'), false);
});
