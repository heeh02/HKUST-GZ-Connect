'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CampusBrowserManager } = require('../lib/campus-browser-manager');

class FakeVault {
  constructor(options) { this.options = options; }
}

class FakeBrowser {
  constructor(options) {
    this.options = options;
    this.routingSuspended = false;
    this.routingRequestsBlocked = true;
    this.opens = [];
  }
  async open(...args) { this.opens.push(args); }
  suspendRoutingPolicy() { this.routingSuspended = true; return 'suspended'; }
  resumeRoutingPolicy(port) { this.routingSuspended = false; return port; }
  close() { return 'closed'; }
  ownsWebContents(value) { return value === 'owned'; }
  handleCertificateError(value) { return value; }
  setLocale(...args) { this.locale = args; }
}

function fixture(overrides = {}) {
  const errors = [];
  const manager = new CampusBrowserManager({
    BrowserWindow: function BrowserWindow() {},
    WebContentsView: function WebContentsView() {},
    session: {},
    dialog: {},
    safeStorage: {},
    platform: 'darwin',
    credentialFile: '/fixture/campus-credentials.json',
    certificateTrust: { isTrusted() {}, trust() {} },
    parentWindow: () => null,
    toolbarFile: '/fixture/campus-browser.html',
    toolbarPreload: '/fixture/toolbar.js',
    campusPreload: '/fixture/preload.js',
    routingPolicy: {},
    ensureCampusReady: async () => true,
    resolveRoute: () => ({ route: 'campus' }),
    ensureConnected: async () => ({ ok: true }),
    getSocksPort: () => 6180,
    getLocale: () => 'zh',
    getTranslator: () => (key, vars) => vars?.message ? `${key}:${vars.message}` : key,
    showRoutingRules: () => {},
    reportError: (message) => errors.push(message),
    CampusBrowserClass: FakeBrowser,
    CredentialVaultClass: FakeVault,
    ...overrides,
  });
  return { errors, manager };
}

test('manager creates one browser with Engine-neutral injected policies', async () => {
  const f = fixture();
  const result = await f.manager.open({ url: 'https://campus.example.test/x' });
  assert.deepEqual(result, {
    ok: true, url: 'https://campus.example.test/x', route: 'campus',
  });
  const browser = f.manager.browser;
  assert.deepEqual(browser.opens, [['https://campus.example.test/x', 6180, 'campus']]);
  assert.equal(f.manager.getOrCreate(), browser);
  assert.equal(browser.options.credentialVault.options.filePath, '/fixture/campus-credentials.json');
  assert.equal(Object.hasOwn(browser.options, 'gatewayToken'), false);
});

test('custom Profile uses its isolated partition and a local blank home without network fallback', async () => {
  const partition = `persist:campus-workspace-${'1'.repeat(32)}`;
  let connectionCalls = 0;
  const f = fixture({
    homeUrl: null,
    browserPartition: partition,
    ensureConnected: async () => { connectionCalls += 1; return { ok: true }; },
  });
  const result = await f.manager.open();
  assert.equal(result.url, 'about:blank');
  assert.equal(f.manager.browser.options.homeUrl, 'about:blank');
  assert.equal(f.manager.browser.options.partition, partition);
  assert.deepEqual(f.manager.browser.opens, [['about:blank', 6180, 'direct']]);
  assert.equal(connectionCalls, 0);
});

test('route, connection and browser failures return bounded UI results', async () => {
  const route = fixture({ resolveRoute: () => { throw new Error('route-failed'); } });
  assert.deepEqual(await route.manager.open('https://x.test'), {
    ok: false, error: 'route-failed',
  });
  const connection = fixture({ ensureConnected: async () => ({ ok: false, error: 'offline' }) });
  assert.deepEqual(await connection.manager.open('https://x.test'), {
    ok: false, error: 'offline',
  });
  class FailingBrowser extends FakeBrowser {
    async open() { throw new Error('synthetic'); }
  }
  const browser = fixture({ CampusBrowserClass: FailingBrowser });
  assert.deepEqual(await browser.manager.open('https://x.test'), {
    ok: false, error: 'error.browserStart:synthetic',
  });
});

test('lifecycle and certificate wrappers are inert before creation and delegate after', () => {
  const f = fixture();
  assert.equal(f.manager.suspendRoutingPolicy(), null);
  assert.equal(f.manager.ownsWebContents('owned'), false);
  f.manager.getOrCreate();
  assert.equal(f.manager.suspendRoutingPolicy(), 'suspended');
  assert.equal(f.manager.routingSuspended, true);
  assert.equal(f.manager.resumeRoutingPolicy(7000), 7000);
  assert.equal(f.manager.ownsWebContents('owned'), true);
  assert.deepEqual(f.manager.handleCertificateError({ origin: 'fixture' }), { origin: 'fixture' });
  f.manager.setLocale('en', () => {});
  assert.equal(f.manager.browser.locale[0], 'en');
  const retired = f.manager.browser;
  assert.equal(f.manager.close(), 'closed');
  assert.equal(f.manager.hasBrowser, false);
  assert.notEqual(f.manager.getOrCreate(), retired);
});
