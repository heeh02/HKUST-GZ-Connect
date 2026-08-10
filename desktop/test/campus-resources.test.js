'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  loadCampusResources,
  mergeCampusResources,
  normalizeCustomResources,
  normalizeResource,
} = require('../lib/campus-resources');
const {
  ROUTE_CAMPUS,
  ROUTE_DIRECT,
  partitionForRoute,
  proxyConfigForRoute,
  routeForUrl,
} = require('../lib/campus-route');

test('bundled campus resources are unique reviewed HTTPS links', () => {
  const resources = loadCampusResources();
  assert.ok(resources.length >= 3);
  assert.equal(new Set(resources.map((resource) => resource.id)).size, resources.length);
  for (const resource of resources) {
    assert.match(resource.url, /^https:\/\/[^/]+/);
    assert.ok(resource.name.length > 0);
  }
});

test('invalid or executable resource entries are rejected', () => {
  assert.equal(normalizeResource({ id: 'bad space', name: 'Bad', url: 'https://example.com' }), null);
  assert.equal(normalizeResource({ id: 'bad', name: 'Bad', url: 'javascript:alert(1)' }), null);
});

test('partner sites default to direct while campus sites default to tunnel', () => {
  assert.equal(routeForUrl('https://outlook.office.com/owa/'), ROUTE_DIRECT);
  assert.equal(routeForUrl('https://hkust-gz.instructure.com/'), ROUTE_DIRECT);
  assert.equal(routeForUrl('https://onestop-online.hkust-gz.edu.cn/'), ROUTE_CAMPUS);
});

test('route proxy configs stay isolated from system networking', () => {
  assert.deepEqual(proxyConfigForRoute(ROUTE_CAMPUS, 6180), {
    mode: 'fixed_servers',
    proxyRules: 'socks5://127.0.0.1:6180',
    proxyBypassRules: '<-loopback>',
  });
  assert.deepEqual(proxyConfigForRoute(ROUTE_DIRECT, 6180), { mode: 'direct' });
  assert.equal(partitionForRoute(ROUTE_CAMPUS), 'persist:hkustgz-campus-browser');
  assert.equal(partitionForRoute(ROUTE_DIRECT), 'persist:hkustgz-direct-browser');
});

test('custom resources are bounded, normalized, and merged after built-ins', () => {
  const custom = normalizeCustomResources([
    { id: 'portal', name: '自定义门户', url: 'https://example.com', route: 'direct' },
    { id: 'portal', name: '重复', url: 'https://duplicate.example.com' },
    { id: 'bad', name: '', url: 'https://bad.example.com' },
  ]);
  assert.equal(custom.length, 1);
  assert.equal(custom[0].route, ROUTE_DIRECT);
  const merged = mergeCampusResources([
    { id: 'home', name: '学校主页', url: 'https://www.hkust-gz.edu.cn/', route: ROUTE_CAMPUS },
  ], custom);
  assert.deepEqual(merged.map((resource) => resource.id), ['home', 'portal']);
  assert.equal(merged[0].builtin, true);
  assert.equal(merged[1].builtin, false);
});

test('legacy direct private shortcuts are migrated to the campus tunnel', () => {
  const [resource] = normalizeCustomResources([{
    id: 'legacy-router',
    name: 'Legacy private site',
    description: '',
    url: 'http://192.168.1.10:8080/',
    route: 'direct',
  }]);
  assert.equal(resource.route, 'campus');
});
