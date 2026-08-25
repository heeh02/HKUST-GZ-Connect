'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  DomainRoutePolicyStore,
  buildDomainRoutePac,
  normalizeDomainRoutePolicy,
  resolveDomainRouteForUrl,
} = require('../../../../lib/routing/policy/domain-route-policy');

function evaluate(source, url, host) {
  const context = {};
  vm.runInNewContext(source, context);
  return context.FindProxyForURL(url, host);
}

test('normalizes the shared policy without retaining paths, queries, or credentials', () => {
  const policy = normalizeDomainRoutePolicy({
    userRules: [{
      host: 'Login.Example.com.', includeSubdomains: false, route: 'direct', updatedAt: 2,
    }],
    customResources: [{
      url: 'https://portal.example.com:4433/path?SAMLRequest=secret', route: 'campus',
    }],
    serverResources: [{ url: 'https://vendor.example/auth?token=secret', route: 'direct' }],
  });
  assert.deepEqual(policy.userExact, [{ host: 'login.example.com', route: 'direct' }]);
  assert.deepEqual(policy.customExact, [{ host: 'portal.example.com', route: 'campus' }]);
  assert.deepEqual(policy.serverExact, [{ host: 'vendor.example', route: 'direct' }]);
  assert.doesNotMatch(JSON.stringify(policy), /SAMLRequest|token|secret|4433|\/path/);
});

test('browser resolution follows user, custom, school, server, then safe default', () => {
  const options = {
    userRules: [{
      host: 'office.com', includeSubdomains: true, route: 'campus', updatedAt: 1,
    }],
    customResources: [{ url: 'https://outlook.office.com/owa/', route: 'direct' }],
    serverResources: [{ url: 'https://vendor.example/service', route: 'direct' }],
  };
  assert.equal(resolveDomainRouteForUrl('https://outlook.office.com/', options).source, 'user-subdomain');
  assert.equal(resolveDomainRouteForUrl('https://library.hkust-gz.edu.cn/', options).source, 'builtin');
  assert.equal(resolveDomainRouteForUrl('https://vendor.example/', options).source, 'server-resource');
  assert.equal(resolveDomainRouteForUrl('https://unknown.example/', options).route, 'campus');
});

test('reviewed profile domains replace static deployment defaults when supplied', () => {
  const options = {
    schoolDomains: ['campus.example.edu'],
    directPartnerDomains: ['partner.example.com'],
  };
  assert.deepEqual(normalizeDomainRoutePolicy(options).builtinSubdomains, [
    { host: 'partner.example.com', route: 'direct' },
    { host: 'campus.example.edu', route: 'campus' },
  ]);
  assert.equal(resolveDomainRouteForUrl('https://app.partner.example.com/', options).route, 'direct');
  assert.equal(resolveDomainRouteForUrl('https://portal.campus.example.edu/', options).route, 'campus');
});

test('internal PAC keeps one session while switching hosts by the shared policy', () => {
  const source = buildDomainRoutePac({
    userRules: [
      { host: 'login.microsoftonline.com', includeSubdomains: false, route: 'direct', updatedAt: 2 },
      { host: 'example.edu', includeSubdomains: true, route: 'campus', updatedAt: 1 },
    ],
    customResources: [{ url: 'https://103.189.154.10:4433/', route: 'campus' }],
  }, 6180);
  assert.equal(evaluate(source, 'https://login.microsoftonline.com/saml', 'login.microsoftonline.com'), 'DIRECT');
  assert.equal(evaluate(source, 'https://id.example.edu/', 'id.example.edu'), 'SOCKS5 127.0.0.1:6180');
  assert.equal(evaluate(source, 'https://103.189.154.10:4433/', '103.189.154.10'), 'SOCKS5 127.0.0.1:6180');
  assert.equal(evaluate(source, 'https://unknown.example/', 'unknown.example'), 'SOCKS5 127.0.0.1:6180');
});

test('internal PAC never lets local and link-local literals bypass the isolated tunnel', () => {
  const source = buildDomainRoutePac({
    userRules: [
      { host: 'localhost', includeSubdomains: false, route: 'direct', updatedAt: 3 },
      { host: '127.0.0.1', includeSubdomains: false, route: 'direct', updatedAt: 2 },
      { host: '192.168.1.1', includeSubdomains: false, route: 'direct', updatedAt: 1 },
    ],
  }, 6180, { campusPrivateIpv4: true });
  for (const host of ['localhost', 'api.localhost', 'device.local', '127.0.0.1',
    '100.64.1.2', '169.254.2.3', '192.168.1.1', '224.0.0.1', '::1']) {
    assert.equal(evaluate(source, `https://${host}/`, host), 'SOCKS5 127.0.0.1:6180');
  }
});

test('JavaScript resolver and PAC share the same direct-route safety override', () => {
  const options = {
    userRules: [{
      host: '192.168.1.1', includeSubdomains: false, route: 'direct', updatedAt: 1,
    }],
    customResources: [{ url: 'http://10.20.30.40:8080/', route: 'direct' }],
    serverResources: [{ url: 'https://169.254.1.2/', route: 'direct' }],
  };
  assert.equal(resolveDomainRouteForUrl('https://192.168.1.1/', options).source, 'safety');
  assert.equal(resolveDomainRouteForUrl('https://192.168.1.1/', options).route, 'campus');
  assert.equal(evaluate(
    buildDomainRoutePac(options, 6180, { campusPrivateIpv4: true }),
    'https://192.168.1.1/',
    '192.168.1.1',
  ), 'SOCKS5 127.0.0.1:6180');
  for (const host of ['10.20.30.40', '169.254.1.2']) {
    assert.equal(evaluate(
      buildDomainRoutePac(options, 6180, { campusPrivateIpv4: true }),
      `https://${host}/`,
      host,
    ), 'SOCKS5 127.0.0.1:6180');
  }
  const normalized = normalizeDomainRoutePolicy(options);
  assert.equal(normalized.customExact[0].route, 'campus');
  assert.equal(normalized.serverExact[0].route, 'campus');
});

test('external PAC can share rules while retaining a direct default', () => {
  const source = buildDomainRoutePac({
    userRules: [
      { host: 'campus.example', includeSubdomains: true, route: 'campus', updatedAt: 1 },
    ],
  }, 6180, { defaultRoute: 'direct' });
  assert.equal(evaluate(source, 'https://campus.example/', 'campus.example'), 'SOCKS5 127.0.0.1:6180');
  assert.equal(evaluate(source, 'https://public.example/', 'public.example'), 'DIRECT');
});

test('strict browser policy selects an authenticated HTTP proxy frontend', () => {
  const source = buildDomainRoutePac({}, 6180, { proxyKind: 'http' });
  assert.equal(evaluate(source, 'https://campus.example/', 'campus.example'), 'PROXY 127.0.0.1:6180');
  assert.throws(() => buildDomainRoutePac({}, 6180, { proxyKind: 'ftp' }), /代理类型/);
});

test('DomainRoutePolicyStore persists mutations and resolves against live local resources', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-policy-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let customResources = [{ url: 'https://vendor.example:4433/', route: 'direct' }];
  const store = new DomainRoutePolicyStore({
    filePath: path.join(directory, 'routing-rules.json'),
    customResources: () => customResources,
  });
  assert.equal(store.resolve('https://vendor.example:4433/').route, 'direct');
  store.upsert({ host: 'vendor.example', route: 'campus' }, 50);
  assert.equal(store.resolve('https://vendor.example:4433/').source, 'user-exact');
  assert.equal(new DomainRoutePolicyStore({
    filePath: store.filePath,
    customResources: () => customResources,
  }).list()[0].route, 'campus');
  const replaced = store.upsert({
    host: 'new-vendor.example',
    includeSubdomains: true,
    route: 'direct',
    previous: { host: 'vendor.example', includeSubdomains: false },
  }, 60);
  assert.equal(replaced.rules.length, 1);
  assert.equal(replaced.rules[0].host, 'new-vendor.example');
  assert.equal(replaced.rules[0].includeSubdomains, true);
  store.remove({ host: 'new-vendor.example', includeSubdomains: true });
  customResources = [];
  assert.equal(store.resolve('https://vendor.example:4433/').route, 'campus');
});
