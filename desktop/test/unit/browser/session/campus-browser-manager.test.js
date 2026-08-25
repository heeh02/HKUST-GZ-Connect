'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CampusBrowserManager,
  browserProfilePresentation,
} = require('../../../../lib/browser/session/campus-browser-manager');

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
  closeForContextSwitch() { this.contextClosed = true; return Promise.resolve(true); }
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
    browserPartition: 'persist:campus-workspace-test',
    routingPolicy: {},
    ensureCampusReady: async () => true,
    resolveRoute: () => ({ route: 'campus' }),
    ensureConnected: async () => ({ ok: true }),
    getSocksPort: () => 6180,
    getLocale: () => 'zh',
    getTranslator: () => (key, vars) => vars?.message ? `${key}:${vars.message}` : key,
    getProfilePresentation: () => ({ schoolName: 'Example University', unverified: false }),
    showItemInFolder: () => {},
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
  assert.deepEqual(browser.options.profilePresentation, {
    schoolName: 'Example University', unverified: false,
  });
  assert.equal(Object.hasOwn(browser.options, 'gatewayToken'), false);
});

test('Browser presentation keeps only bounded school and trust display fields', () => {
  assert.deepEqual(browserProfilePresentation({
    schoolName: ' Example University ', unverified: true, profileKey: 'must-not-cross',
  }), { schoolName: 'Example University', unverified: true });
  assert.throws(() => browserProfilePresentation({
    schoolName: '<script>', unverified: false,
  }), /presentation/u);
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

test('a Direct WebResource opens without starting or requiring the campus Engine', async () => {
  let connectionCalls = 0;
  const f = fixture({
    resolveRoute: () => ({ route: 'direct' }),
    ensureConnected: async () => { connectionCalls += 1; return { ok: false, error: 'offline' }; },
  });
  const result = await f.manager.open({ url: 'https://outlook.office.com/owa/', route: 'direct' });
  assert.equal(result.ok, true);
  assert.equal(result.route, 'direct');
  assert.equal(connectionCalls, 0);
  assert.deepEqual(f.manager.browser.opens, [[
    'https://outlook.office.com/owa/', 6180, 'direct',
  ]]);
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

test('context switch close retains ownership until Browser confirms closed', async () => {
  const f = fixture();
  assert.equal(await f.manager.closeForContextSwitch(), true);
  const browser = f.manager.getOrCreate();
  assert.equal(await f.manager.closeForContextSwitch(), true);
  assert.equal(browser.contextClosed, true);
  assert.equal(f.manager.browser, null);
});

test('clearing site data closes the active Browser and clears only its bound partition', async () => {
  const calls = [];
  const partition = {
    closeAllConnections: async () => { calls.push('connections'); },
    clearStorageData: async () => { calls.push('storage'); },
    clearCache: async () => { calls.push('cache'); },
  };
  const f = fixture({
    session: {
      fromPartition(value) {
        calls.push(['partition', value]);
        return partition;
      },
    },
  });
  const browser = f.manager.getOrCreate();
  assert.equal(await f.manager.clearSiteData(), true);
  assert.equal(browser.contextClosed, true);
  assert.equal(f.manager.browser, null);
  assert.deepEqual(calls, [
    ['partition', 'persist:campus-workspace-test'],
    'connections', 'storage', 'cache',
  ]);
});

test('site-data clearing fails closed when the bound Session cannot clear storage', async () => {
  const f = fixture({ session: { fromPartition: () => ({ clearCache() {} }) } });
  assert.equal(await f.manager.clearSiteData(), false);
});
