'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveRouteForUrl } = require('../lib/route-resolver');

test('resolves exact user, suffix user, built-in, inherited, then default routes', () => {
  const userRules = [
    { host: 'microsoftonline.com', includeSubdomains: true, route: 'campus', updatedAt: 1 },
    { host: 'login.microsoftonline.com', includeSubdomains: false, route: 'direct', updatedAt: 2 },
  ];
  assert.deepEqual(resolveRouteForUrl('https://login.microsoftonline.com/saml?secret=value', {
    userRules,
  }), {
    route: 'direct',
    source: 'user-exact',
    matchedRule: { host: 'login.microsoftonline.com', includeSubdomains: false },
  });
  assert.equal(
    resolveRouteForUrl('https://device.microsoftonline.com/', { userRules }).source,
    'user-subdomain',
  );
  assert.equal(
    resolveRouteForUrl('https://outlook.office.com/', { inheritedRoute: 'campus' }).source,
    'builtin',
  );
  assert.deepEqual(
    resolveRouteForUrl('https://login.example.com/', { inheritedRoute: 'direct' }),
    { route: 'direct', source: 'inherited', matchedRule: null },
  );
  assert.deepEqual(resolveRouteForUrl('https://portal.example/', {}), {
    route: 'campus', source: 'default', matchedRule: null,
  });
});

test('a suffix rule matches root and descendants but not lookalikes', () => {
  const userRules = [
    { host: 'example.edu', includeSubdomains: true, route: 'direct', updatedAt: 1 },
  ];
  assert.equal(resolveRouteForUrl('https://example.edu/', { userRules }).route, 'direct');
  assert.equal(resolveRouteForUrl('https://id.example.edu/', { userRules }).route, 'direct');
  assert.equal(resolveRouteForUrl('https://notexample.edu/', { userRules }).route, 'campus');
});

test('the most-specific matching subdomain rule wins', () => {
  const userRules = [
    { host: 'example.edu', includeSubdomains: true, route: 'campus', updatedAt: 20 },
    { host: 'id.example.edu', includeSubdomains: true, route: 'direct', updatedAt: 10 },
  ];
  const resolution = resolveRouteForUrl('https://login.id.example.edu/', { userRules });
  assert.equal(resolution.route, 'direct');
  assert.deepEqual(resolution.matchedRule, {
    host: 'id.example.edu', includeSubdomains: true,
  });
});

test('custom websites, school defaults, and server suggestions share one precedence chain', () => {
  const target = 'https://outlook.office.com/owa/';
  const customResources = [{ url: target, route: 'campus' }];
  const serverResources = [{ url: target, route: 'direct' }];
  assert.equal(resolveRouteForUrl(target, { customResources, serverResources }).source, 'custom-resource');
  assert.equal(resolveRouteForUrl(target, { serverResources }).source, 'builtin');
  assert.equal(resolveRouteForUrl('https://library.hkust-gz.edu.cn/', {}).source, 'builtin');
  assert.deepEqual(resolveRouteForUrl('https://vendor.example/', {
    serverResources: [{ url: 'https://vendor.example/service', route: 'direct' }],
  }), {
    route: 'direct', source: 'server-resource', matchedRule: null,
  });
});

test('invalid and non-web targets fail closed to campus', () => {
  for (const target of ['not a URL', 'file:///tmp/page.html', 'javascript:alert(1)']) {
    assert.deepEqual(resolveRouteForUrl(target, { inheritedRoute: 'direct' }), {
      route: 'campus', source: 'default', matchedRule: null,
    });
  }
});
