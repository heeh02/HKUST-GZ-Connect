'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  CAMPUS_PARTITION,
  CampusBrowser,
  DEFAULT_CAMPUS_HOME,
  FIND_BAR_HEIGHT,
  SLOW_LOADING_HINT_MS,
  TOOLBAR_HEIGHT,
  applyCampusSessionPolicy,
  campusProxyConfig,
  campusWindowChrome,
  nextZoomFactor,
  normalizeCampusUrl,
  safePopupUrl,
} = require('../lib/campus-browser');
const {
  DIRECT_PARTITION,
  ROUTE_CAMPUS,
  ROUTE_DIRECT,
  proxyConfigForRoute,
} = require('../lib/campus-route');
const { certificateFingerprint } = require('../lib/campus-certificate-trust');

const CERTIFICATE_PEM = [
  '-----BEGIN CERTIFICATE-----',
  Buffer.from('fixture-certificate-der').toString('base64'),
  '-----END CERTIFICATE-----',
].join('\n');

test('campus URLs default to the school home and accept host-only input', () => {
  assert.equal(normalizeCampusUrl(''), DEFAULT_CAMPUS_HOME);
  assert.equal(normalizeCampusUrl('example.internal/path'), 'https://example.internal/path');
  assert.equal(normalizeCampusUrl('http://10.0.0.8/portal'), 'http://10.0.0.8/portal');
});

test('campus URLs reject executable schemes and embedded credentials', () => {
  assert.throws(() => normalizeCampusUrl('javascript:alert(1)'), /HTTP/);
  assert.throws(() => normalizeCampusUrl('https://user:pass@example.internal'), /格式/);
  assert.equal(safePopupUrl('https://example.internal/sso'), true);
  assert.equal(safePopupUrl('file:///etc/passwd'), false);
});

test('campus browser proxy is loopback-only SOCKS5', () => {
  assert.deepEqual(campusProxyConfig(1080), {
    mode: 'fixed_servers',
    proxyRules: 'socks5://127.0.0.1:1080',
    proxyBypassRules: '<-loopback>',
  });
  assert.throws(() => campusProxyConfig(80), /端口/);
});

test('campus pages cannot reach services on this computer around the proxy', () => {
  // Chromium bypasses proxies for loopback and link-local addresses unless the
  // implicit rule is removed, which would let a campus page probe local ports.
  assert.equal(campusProxyConfig(1080).proxyBypassRules, '<-loopback>');
});

test('campus pages are denied device and capability permissions', () => {
  const decisions = [];
  const campusSession = {
    setPermissionRequestHandler: (handler) => decisions.push(['request', handler]),
    setPermissionCheckHandler: (handler) => decisions.push(['check', handler]),
    setDevicePermissionHandler: (handler) => decisions.push(['device', handler]),
  };
  assert.equal(applyCampusSessionPolicy(campusSession), campusSession);
  assert.deepEqual(decisions.map(([kind]) => kind), ['request', 'check', 'device']);

  let granted = null;
  decisions[0][1]({}, 'media', (allowed) => { granted = allowed; });
  assert.equal(granted, false);
  assert.equal(decisions[1][1]({}, 'geolocation'), false);
  assert.equal(decisions[2][1]({}), false);
});

test('a session without the newer permission APIs still configures cleanly', () => {
  const legacySession = {};
  assert.equal(applyCampusSessionPolicy(legacySession), legacySession);
});

test('Windows tabs share the native caption row without covering window controls', () => {
  assert.deepEqual(campusWindowChrome('win32'), {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f1ecd6',
      symbolColor: '#0b2a5b',
      height: 34,
    },
  });
});

test('a certificate exception needs confirmation and is scoped to one campus-browser origin', async () => {
  const ownedContents = {};
  const stored = new Map();
  let promptCount = 0;
  let promptOptions;
  const browser = new CampusBrowser({
    dialog: {
      showMessageBox: async (_window, options) => {
        promptCount++;
        promptOptions = options;
        return { response: 0 };
      },
    },
    certificateTrust: {
      isTrusted: (origin, fingerprint) => stored.get(origin) === fingerprint,
      trust: (origin, fingerprint) => stored.set(origin, fingerprint),
    },
  });
  browser.tabs = [{ view: { webContents: ownedContents } }];

  assert.equal(browser.ownsWebContents(ownedContents), true);
  assert.equal(browser.ownsWebContents({}), false);

  const decisions = [];
  await browser.handleCertificateError({
    url: 'https://103.189.154.10:4433/login',
    error: 'net::ERR_CERT_AUTHORITY_INVALID',
    certificate: {
      data: CERTIFICATE_PEM,
      subjectName: '103.189.154.10',
      issuerName: 'HKUST(GZ) test gateway',
      validStart: 1700000000,
      validExpiry: 1800000000,
    },
    callback: (allowed) => decisions.push(allowed),
  });

  const fingerprint = certificateFingerprint(CERTIFICATE_PEM);
  assert.deepEqual(decisions, [true]);
  assert.equal(stored.get('https://103.189.154.10:4433'), fingerprint);
  assert.equal(promptCount, 1);
  assert.match(promptOptions.detail, /SHA-256/);
  assert.match(promptOptions.detail, /ERR_CERT_AUTHORITY_INVALID/);
  assert.match(promptOptions.detail, /HKUST\(GZ\) test gateway/);
  assert.match(promptOptions.detail, /2023/);

  await browser.handleCertificateError({
    url: 'https://103.189.154.10:4433/again',
    error: 'net::ERR_CERT_AUTHORITY_INVALID',
    certificate: { data: CERTIFICATE_PEM },
    callback: (allowed) => decisions.push(allowed),
  });
  assert.deepEqual(decisions, [true, true]);
  assert.equal(promptCount, 1, 'the same exact certificate should not prompt again');

  browser.dialog.showMessageBox = async () => ({ response: 1 });
  await browser.handleCertificateError({
    url: 'https://103.189.154.10:4443/login',
    error: 'net::ERR_CERT_AUTHORITY_INVALID',
    certificate: { data: CERTIFICATE_PEM },
    callback: (allowed) => decisions.push(allowed),
  });
  assert.deepEqual(decisions, [true, true, false], 'a different port must not inherit the pin');
});

test('campus browser uses route-specific persistent sessions and never the system proxy', async () => {
  const calls = [];
  function makeSession(name) {
    return {
      name,
      setProxy: async (config) => calls.push([name, 'proxy', config]),
      closeAllConnections: async () => calls.push([name, 'close-connections']),
    };
  };
  const campusSession = makeSession('campus');
  const directSession = makeSession('direct');
  const sessions = new Map([
    ['persist:hkustgz-campus-browser', campusSession],
    [DIRECT_PARTITION, directSession],
  ]);
  const fakeSession = {
    fromPartition: (partition) => {
      calls.push(['partition', partition]);
      return sessions.get(partition);
    },
  };
  class FakeWebContents extends EventEmitter {
    setWindowOpenHandler(handler) { this.popupHandler = handler; }
    executeJavaScript() { return Promise.resolve(); }
    getTitle() { return 'Test'; }
    getURL() { return this.url || ''; }
    isDestroyed() { return false; }
    canGoBack() { return false; }
    canGoForward() { return false; }
    reload() {}
    close() {}
    async loadURL(url) { this.url = url; calls.push(['load', url]); }
  }
  class FakeWebContentsView {
    constructor(options) {
      this.options = options;
      this.webContents = new FakeWebContents();
      calls.push(['view', options]);
    }
    setBounds(bounds) { calls.push(['bounds', bounds]); }
    setVisible(visible) { calls.push(['visible', visible]); }
  }
  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new FakeWebContents();
      this.contentView = {
        addChildView: (view) => calls.push(['add-view', view]),
        removeChildView: (view) => calls.push(['remove-view', view]),
      };
      this.destroyed = false;
      calls.push(['window', options]);
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    getContentSize() { return [1200, 820]; }
    show() { calls.push(['show']); }
    focus() { calls.push(['focus']); }
    async loadFile(file) { calls.push(['toolbar', file]); }
    close() { this.destroyed = true; }
  }

  const browser = new CampusBrowser({
    BrowserWindow: FakeBrowserWindow,
    WebContentsView: FakeWebContentsView,
    session: fakeSession,
    parentWindow: () => null,
    toolbarFile: '/app/campus-browser.html',
    campusPreload: '/app/campus-preload.js',
  });
  await browser.open('portal.example.internal', 1080);

  assert.deepEqual(calls[0], ['partition', CAMPUS_PARTITION]);
  assert.deepEqual(calls[1], ['campus', 'proxy', proxyConfigForRoute(ROUTE_CAMPUS, 1080)]);
  assert.ok(calls.some((call) => call[0] === 'toolbar'));
  assert.ok(calls.some((call) =>
    call[0] === 'load' && call[1] === 'https://portal.example.internal/'));
  assert.equal(browser.view.options.webPreferences.session, campusSession);
  assert.equal(browser.view.options.webPreferences.preload, '/app/campus-preload.js');
  assert.equal(browser.view.options.webPreferences.nodeIntegration, false);
  assert.equal(browser.view.options.webPreferences.sandbox, true);
  assert.equal(browser.view.options.webPreferences.webSecurity, true);

  await browser.open('outlook.office.com/owa/', 1080, ROUTE_DIRECT);
  assert.equal(browser.tabs.length, 2);
  assert.equal(browser.activeTab().view.webContents.getURL(), 'https://outlook.office.com/owa/');
  assert.equal(browser.activeTab().route, ROUTE_DIRECT);
  assert.equal(browser.activeTab().view.options.webPreferences.session, directSession);
  assert.equal(browser.switchTab(browser.tabs[0].id), true);
  assert.equal(browser.activeTab().view.webContents.getURL(), 'https://portal.example.internal/');
  assert.equal(browser.closeTab(browser.activeTabId), true);
  assert.equal(browser.tabs.length, 1);

  const firstId = browser.tabs[0].id;
  assert.equal(await browser.setTabRoute(firstId, ROUTE_CAMPUS), true);
  assert.equal(browser.tabs[0].route, ROUTE_CAMPUS);
  assert.equal(browser.tabs[0].view.options.webPreferences.session, campusSession);
  assert.equal(browser.tabs[0].view.webContents.getURL(), 'https://outlook.office.com/owa/');

  await browser.configure(6180, ROUTE_CAMPUS);
  assert.ok(calls.some((call) =>
    call[0] === 'campus' && call[1] === 'proxy' && call[2].proxyRules === 'socks5://127.0.0.1:6180'));
});

test('a provisional load failure keeps the failed URL and shows an error page', async () => {
  function makeSession(name) {
    return { name, setProxy: async () => {}, closeAllConnections: async () => {} };
  }
  const sessions = new Map([
    ['persist:hkustgz-campus-browser', makeSession('campus')],
    [DIRECT_PARTITION, makeSession('direct')],
  ]);
  class FakeWebContents extends EventEmitter {
    setWindowOpenHandler(handler) { this.popupHandler = handler; }
    executeJavaScript() { return Promise.resolve(); }
    getTitle() { return 'Test'; }
    getURL() { return this.url || ''; }
    isDestroyed() { return false; }
    canGoBack() { return false; }
    canGoForward() { return false; }
    reload() {}
    close() {}
    async loadURL(url) { this.url = url; }
  }
  class FakeWebContentsView {
    constructor(options) {
      this.options = options;
      this.webContents = new FakeWebContents();
    }
    setBounds() {}
    setVisible() {}
  }
  class FakeBrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new FakeWebContents();
      this.contentView = { addChildView: () => {}, removeChildView: () => {} };
      this.destroyed = false;
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    getContentSize() { return [1200, 820]; }
    show() {}
    focus() {}
    async loadFile() {}
    close() { this.destroyed = true; }
  }

  const browser = new CampusBrowser({
    BrowserWindow: FakeBrowserWindow,
    WebContentsView: FakeWebContentsView,
    session: { fromPartition: (partition) => sessions.get(partition) },
    parentWindow: () => null,
    toolbarFile: '/app/campus-browser.html',
    campusPreload: '/app/campus-preload.js',
  });
  await browser.open('www.google.com', 1080, ROUTE_DIRECT);
  const tab = browser.activeTab();
  assert.equal(tab.view.webContents.getURL(), 'https://www.google.com/');

  tab.view.webContents.emit(
    'did-fail-provisional-load',
    null,
    -7,
    'ERR_TIMED_OUT',
    'https://www.google.com/',
    true,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(tab.failedUrl, 'https://www.google.com/');
  assert.equal(tab.loading, false);
  assert.ok(tab.view.webContents.getURL().startsWith('data:text/html'),
    'the failed tab renders a local error page instead of staying blank');

  assert.equal(await browser.setTabRoute(tab.id, ROUTE_CAMPUS), true);
  assert.equal(tab.view.webContents.getURL(), 'https://www.google.com/',
    'switching the route retries the failed site instead of the school home');
  assert.notEqual(tab.view.webContents.getURL(), DEFAULT_CAMPUS_HOME);
});

test('zoom factors step by 0.1, reset to 1, and clamp to [0.5, 2]', () => {
  assert.equal(nextZoomFactor(1, '='), 1.1);
  assert.equal(nextZoomFactor(1, '+'), 1.1);
  assert.equal(nextZoomFactor(1, '-'), 0.9);
  assert.equal(nextZoomFactor(1.7, '+'), 1.8, 'float drift must not accumulate');
  assert.equal(nextZoomFactor(1.4, '0'), 1);
  assert.equal(nextZoomFactor(0.5, '-'), 0.5);
  assert.equal(nextZoomFactor(2, '='), 2);
  assert.equal(nextZoomFactor(NaN, '='), 1.1);
});

// A minimal in-memory harness mirroring the fakes used above, plus recording
// of toolbar state scripts and find/zoom calls on tab web contents.
function createFakeBrowser(extra = {}) {
  const calls = [];
  const scripts = [];
  function makeSession(name) {
    const routeSession = new EventEmitter();
    routeSession.name = name;
    routeSession.setProxy = async () => {};
    routeSession.closeAllConnections = async () => {};
    return routeSession;
  }
  const sessions = new Map([
    [CAMPUS_PARTITION, makeSession('campus')],
    [DIRECT_PARTITION, makeSession('direct')],
  ]);
  class FakeWebContents extends EventEmitter {
    setWindowOpenHandler() {}
    executeJavaScript(script) {
      if (typeof script === 'string' && script.includes('campusBrowserUI')) {
        scripts.push(script);
      }
      return Promise.resolve();
    }
    getTitle() { return 'Test'; }
    getURL() { return this.url || ''; }
    isDestroyed() { return false; }
    canGoBack() { return false; }
    canGoForward() { return false; }
    reload() {}
    close() {}
    focus() { this.focused = true; }
    getZoomFactor() { return this.zoom || 1; }
    setZoomFactor(value) { this.zoom = value; }
    findInPage(text, options) {
      (this.findCalls ||= []).push([text, options]);
      return 1;
    }
    stopFindInPage(action) { (this.stopFindCalls ||= []).push(action); }
    async loadURL(url) { this.url = url; }
  }
  class FakeWebContentsView {
    constructor(options) {
      this.options = options;
      this.webContents = new FakeWebContents();
    }
    setBounds(bounds) { calls.push(['bounds', bounds]); }
    setVisible() {}
  }
  class FakeBrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new FakeWebContents();
      this.contentView = { addChildView: () => {}, removeChildView: () => {} };
      this.destroyed = false;
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    getContentSize() { return [1200, 820]; }
    show() {}
    focus() {}
    async loadFile() {}
    close() { this.destroyed = true; }
  }
  const browser = new CampusBrowser({
    BrowserWindow: FakeBrowserWindow,
    WebContentsView: FakeWebContentsView,
    session: { fromPartition: (partition) => sessions.get(partition) },
    parentWindow: () => null,
    toolbarFile: '/app/campus-browser.html',
    campusPreload: '/app/campus-preload.js',
    ...extra,
  });
  return { browser, calls, scripts, sessions };
}

function toolbarState(scripts) {
  const last = scripts.filter((script) => script.includes('setState(')).at(-1);
  return JSON.parse(last.slice(last.indexOf('setState(') + 9, -1));
}

function loadingState(scripts) {
  const state = toolbarState(scripts);
  return { loading: state.loading, slow: state.slow };
}

test('a load slower than ten seconds is flagged per tab', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { browser, scripts } = createFakeBrowser();
  await browser.open('portal.example.internal', 1080, ROUTE_CAMPUS);
  const tab = browser.activeTab();

  tab.view.webContents.emit('did-start-loading');
  assert.deepEqual(loadingState(scripts), { loading: true, slow: false });
  t.mock.timers.tick(SLOW_LOADING_HINT_MS);
  assert.deepEqual(loadingState(scripts), { loading: true, slow: true });

  const other = browser.createTab(DEFAULT_CAMPUS_HOME, ROUTE_CAMPUS);
  assert.equal(browser.activeTab().id, other.id);
  assert.deepEqual(loadingState(scripts), { loading: false, slow: false },
    'switching to a fresh tab must not show the slow hint');

  browser.switchTab(tab.id);
  assert.deepEqual(loadingState(scripts), { loading: true, slow: true },
    'switching back must restore the slow tab state');

  tab.view.webContents.emit('did-stop-loading');
  assert.deepEqual(loadingState(scripts), { loading: false, slow: false });
});

test('zoom shortcuts step once per key press and stay clamped', async () => {
  const { browser } = createFakeBrowser();
  await browser.open('portal.example.internal', 1080);
  const contents = browser.activeTab().view.webContents;
  let prevented = 0;
  const event = { preventDefault: () => { prevented++; } };
  const press = (key, type = 'keyDown') => contents.emit(
    'before-input-event',
    event,
    { meta: true, control: true, key, type },
  );

  press('=');
  assert.equal(contents.getZoomFactor(), 1.1);
  assert.equal(prevented, 1);
  press('=', 'keyUp');
  assert.equal(contents.getZoomFactor(), 1.1, 'key release must not zoom again');
  for (let index = 0; index < 20; index++) press('+');
  assert.equal(contents.getZoomFactor(), 2);
  for (let index = 0; index < 30; index++) press('-');
  assert.equal(contents.getZoomFactor(), 0.5);
  press('0');
  assert.equal(contents.getZoomFactor(), 1);
});

test('toolbar find commands drive findInPage on the active tab', async () => {
  const { browser, calls, scripts } = createFakeBrowser();
  await browser.open('portal.example.internal', 1080);
  const contents = browser.activeTab().view.webContents;
  const hash = (command, value = '') =>
    `about:blank#command=${command}&value=${encodeURIComponent(value)}`;

  browser.handleToolbarCommand(hash('find-open'));
  assert.equal(browser.findOpen, true);
  assert.equal(toolbarState(scripts).findOpen, true);
  const bounds = calls.filter(([kind]) => kind === 'bounds').at(-1)[1];
  assert.equal(bounds.y, TOOLBAR_HEIGHT + FIND_BAR_HEIGHT,
    'the page must move below the open find bar');

  browser.handleToolbarCommand(hash('find', '校园'));
  assert.deepEqual(contents.findCalls.at(-1), ['校园', undefined]);
  browser.handleToolbarCommand(hash('find-next'));
  assert.deepEqual(contents.findCalls.at(-1), ['校园', { forward: true, findNext: true }]);
  browser.handleToolbarCommand(hash('find-prev'));
  assert.deepEqual(contents.findCalls.at(-1), ['校园', { forward: false, findNext: true }]);

  browser.handleToolbarCommand(hash('find', ''));
  assert.deepEqual(contents.stopFindCalls.at(-1), 'clearSelection');
  const findCallsBefore = contents.findCalls.length;
  browser.handleToolbarCommand(hash('find-next'));
  assert.equal(contents.findCalls.length, findCallsBefore,
    'an empty query must not restart the search');

  browser.handleToolbarCommand(hash('find-close'));
  assert.equal(browser.findOpen, false);
  assert.equal(toolbarState(scripts).findOpen, false);
  assert.deepEqual(contents.stopFindCalls.at(-1), 'clearSelection');
  assert.equal(contents.focused, true, 'closing the find bar returns focus to the page');
  const closedBounds = calls.filter(([kind]) => kind === 'bounds').at(-1)[1];
  assert.equal(closedBounds.y, TOOLBAR_HEIGHT);
});

test('downloads ask for a save location and surface failures', async () => {
  const errors = [];
  const prompts = [];
  const dialog = {
    showSaveDialog: async (_window, options) => {
      prompts.push(options);
      return { canceled: false, filePath: '/tmp/课件.pdf' };
    },
  };
  const { browser, sessions } = createFakeBrowser({
    dialog,
    onError: (message) => errors.push(message),
  });

  const campusSession = sessions.get(CAMPUS_PARTITION);
  await browser.configure(1080, ROUTE_CAMPUS);
  await browser.configure(1080, ROUTE_CAMPUS);
  assert.equal(campusSession.listenerCount('will-download'), 1,
    'reconfiguring the same session must not stack download handlers');

  const makeItem = (filename) => {
    const item = new EventEmitter();
    item.filename = filename;
    item.getFilename = () => item.filename;
    item.cancel = () => { item.cancelled = true; };
    item.setSavePath = (savePath) => { item.savePath = savePath; };
    return item;
  };

  const item = makeItem('课件.pdf');
  campusSession.emit('will-download', {}, item);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(prompts, [{ defaultPath: '课件.pdf' }]);
  assert.equal(item.savePath, '/tmp/课件.pdf');
  item.emit('done', {}, 'interrupted');
  assert.deepEqual(errors, ['下载未完成：课件.pdf']);

  dialog.showSaveDialog = async () => ({ canceled: true });
  const cancelled = makeItem('取消.zip');
  campusSession.emit('will-download', {}, cancelled);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled.cancelled, true, 'a cancelled save dialog cancels the download');

  const bare = new CampusBrowser({});
  const headless = makeItem('no-dialog.bin');
  await bare.handleDownload(headless);
  assert.equal(headless.cancelled, true, 'without a dialog the download cannot proceed');
});
