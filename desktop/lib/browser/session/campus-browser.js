'use strict';

const DEFAULT_CAMPUS_HOME = 'https://www.hkust-gz.edu.cn/';
const BLANK_CAMPUS_HOME = 'about:blank';
const {
  CAMPUS_PARTITION,
  ROUTE_CAMPUS,
  ROUTE_DIRECT,
} = require('../../routing/policy/campus-route');
const { resolveDomainRouteForUrl } = require('../../routing/policy/domain-route-policy');
const { normalizeRuleHost } = require('../../routing/rules/routing-rule-store');
const { normalizeToolbarCommand } = require('../toolbar/campus-toolbar-contract');
const { CertificateController } = require('../certificates/certificate-controller');
const { CredentialController } = require('../credentials/credential-controller');
const {
  BrowserSessionManager,
  applyCampusSessionPolicy,
  campusProxyConfig,
  createMemoryRoutingPolicy,
  pacDataUrl,
} = require('./browser-session-manager');
const { DEFAULT_MAX_TABS, TabManager } = require('../tabs/tab-manager');
const { createT } = require('../../platform/i18n/i18n');
const TOOLBAR_HEIGHT = 76;
const FIND_BAR_HEIGHT = 34;
const SLOW_LOADING_HINT_MS = 10000;
const MAX_URL_LENGTH = 2048;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const MAX_TABS = DEFAULT_MAX_TABS;

function normalizeCampusUrl(input, fallback = DEFAULT_CAMPUS_HOME, t = createT('zh')) {
  let value = String(input || '').trim() || fallback;
  if (value === BLANK_CAMPUS_HOME && fallback === BLANK_CAMPUS_HOME) return BLANK_CAMPUS_HOME;
  if (value.length > MAX_URL_LENGTH) throw new Error(t('url.tooLong'));
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(t('url.invalid'));
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(t('url.schemeUnsupported'));
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error(t('url.invalid'));
  }
  return parsed.href;
}

function campusWindowChrome(platform) {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 13, y: 11 },
    };
  }
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#f1ecd6',
        symbolColor: '#0b2a5b',
        height: 34,
      },
    };
  }
  return { titleBarStyle: 'default' };
}

function safePopupUrl(value) {
  if (value === BLANK_CAMPUS_HOME) return true;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// key is '0' to reset, '=' or '+' to zoom in, '-' to zoom out. The product of
// float steps drifts (1.7 + 0.1 === 1.7999…), so round back to one decimal.
function nextZoomFactor(current, key) {
  const base = Number.isFinite(current) ? current : 1;
  const target = key === '0' ? 1 : key === '-' ? base - ZOOM_STEP : base + ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(target * 10) / 10));
}

function navigationForContents(contents) {
  const modern = contents?.navigationHistory;
  const call = (method, fallback = false) => {
    const target = typeof modern?.[method] === 'function' ? modern : contents;
    if (typeof target?.[method] !== 'function') return fallback;
    try {
      const result = target[method]();
      return method.startsWith('can') ? result === true : true;
    } catch {
      return fallback;
    }
  };
  return {
    canGoBack: () => call('canGoBack'),
    canGoForward: () => call('canGoForward'),
    goBack: () => call('goBack'),
    goForward: () => call('goForward'),
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

// Failure URLs frequently carry SAML assertions, OAuth codes, and other
// one-time credentials in their query or path.  Keep the exact URL on the tab
// for retry, but only render its origin into the user-visible error document so
// screenshots and copied diagnostics cannot disclose those secrets.
function redactedFailedUrl(value, fallback) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return fallback;
    return parsed.origin;
  } catch {
    return fallback;
  }
}

function errorPage(failedUrl, description, t = createT('zh')) {
  const url = escapeHtml(redactedFailedUrl(failedUrl, t('errorPage.unknownUrl')));
  const reason = escapeHtml(description || t('errorPage.networkFailed'));
  const html = `<!doctype html><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(t('errorPage.title'))}</title>
    <style>
      body{margin:0;background:#f7f9fc;color:#1b2536;font-family:-apple-system,"PingFang SC","Segoe UI",sans-serif}
      main{max-width:560px;margin:12vh auto;padding:36px;background:#fff;border:1px solid #e8edf5;border-radius:18px;box-shadow:0 12px 30px rgba(13,30,66,.08)}
      h1{margin:0 0 14px;color:#0b2a5b;font-size:23px}p{line-height:1.7;color:#667085}
      code{display:block;margin-top:16px;padding:12px;background:#f4f7fb;border-radius:10px;word-break:break-all;color:#344054}
    </style>
    <main><h1>${escapeHtml(t('errorPage.heading'))}</h1>
    <p>${escapeHtml(t('errorPage.body'))}</p>
    <code>${url}</code><p>${reason}</p></main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

class CampusBrowser {
  constructor({
    BrowserWindow,
    WebContentsView,
    session,
    dialog,
    certificateTrust,
    credentialVault,
    parentWindow,
    toolbarFile,
    toolbarPreload,
    campusPreload,
    homeUrl = DEFAULT_CAMPUS_HOME,
    routingPolicy,
    ensureCampusReady,
    onManageRoutingRules,
    locale,
    t,
    onError,
    partition = CAMPUS_PARTITION,
  }) {
    this.BrowserWindow = BrowserWindow;
    this.WebContentsView = WebContentsView;
    this.session = session;
    this.dialog = dialog;
    this.credentialVault = credentialVault;
    this.parentWindow = parentWindow;
    this.toolbarFile = toolbarFile;
    this.toolbarPreload = toolbarPreload;
    this.campusPreload = campusPreload;
    this.routingPolicy = routingPolicy || createMemoryRoutingPolicy();
    this.ensureCampusReady = typeof ensureCampusReady === 'function'
      ? ensureCampusReady
      : async () => true;
    this.onManageRoutingRules = onManageRoutingRules;
    this.locale = locale === 'en' ? 'en' : 'zh';
    this.t = typeof t === 'function' ? t : createT(this.locale);
    this.homeUrl = homeUrl === BLANK_CAMPUS_HOME
      ? BLANK_CAMPUS_HOME
      : normalizeCampusUrl(homeUrl, DEFAULT_CAMPUS_HOME, this.t);
    this.onError = onError;
    this.certificateController = new CertificateController({
      trustStore: certificateTrust,
      dialog,
      windowForPrompt: () => this.window,
      locale: () => this.locale,
      t: (key, vars) => this.t(key, vars),
    });
    this.credentialController = new CredentialController({
      vault: credentialVault,
      dialog,
      originForTab: (tab) => this.tabOrigin(tab),
      windowForPrompt: () => this.window,
      t: (key, vars) => this.t(key, vars),
      onError: (message) => this.onError?.(message),
    });
    this.window = null;
    this.view = null;
    this.tabManager = new TabManager({ maxTabs: MAX_TABS });
    this.browserSessionManager = new BrowserSessionManager({
      session,
      partition,
      routingPolicy: this.routingPolicy,
      onSessionReady: (browserSession) => this.applyDownloadHandler(browserSession),
    });
    // One-release compatibility for diagnostics/tests; ownership and mutation
    // live exclusively in CertificateController.
    this.certificateDecisions = this.certificateController.decisions;
    this.downloadSessions = new Set();
    this.findOpen = false;
    this.lastFindQuery = '';
    this.scheduledLayout = null;
    this.scheduledToolbarUpdate = null;
    this.lastToolbarState = null;
  }

  // Keep the existing CampusBrowser diagnostics/test surface while all state
  // mutations flow through the dedicated managers.
  get tabs() { return this.tabManager.tabs; }
  get activeTabId() { return this.tabManager.activeTabId; }
  get nextTabId() { return this.tabManager.nextTabId; }
  get configuredPort() { return this.browserSessionManager.configuredPort; }
  get sessions() { return this.browserSessionManager.sessions; }
  get sessionKey() { return this.browserSessionManager.sessionKey; }
  get campusSession() { return this.browserSessionManager.campusSession; }
  get routingSuspended() { return this.browserSessionManager.suspended; }
  get routingRequestsBlocked() { return this.browserSessionManager.requestsBlocked; }

  ownsWebContents(webContents) {
    return !!webContents && this.tabs.some((tab) => tab?.view?.webContents === webContents);
  }

  // Live language switch: future dialogs and toolbar states use the new
  // strings immediately, and an open chrome window re-renders in place.
  setLocale(nextLocale, nextT) {
    this.locale = nextLocale === 'en' ? 'en' : 'zh';
    this.t = typeof nextT === 'function' ? nextT : createT(this.locale);
    if (!this.window || this.window.isDestroyed()) return;
    this.window.setTitle(this.t('browser.windowTitle'));
    this.window.webContents.send?.('campus-toolbar-locale', this.locale);
    this.updateToolbar();
  }

  async decideCertificateTrust({ origin, fingerprint, error, certificate }) {
    return this.certificateController.promptAndTrust({ origin, fingerprint, error, certificate });
  }

  async handleCertificateError(request) {
    return this.certificateController.handle(request);
  }

  // Electron would otherwise silently drop downloads because the campus
  // sessions have no default download behavior wired to a dialog.
  applyDownloadHandler(routeSession) {
    if (typeof routeSession.on !== 'function' || this.downloadSessions.has(routeSession)) {
      return;
    }
    this.downloadSessions.add(routeSession);
    routeSession.on('will-download', (_event, item) => this.handleDownload(item));
  }

  async handleDownload(item) {
    if (!this.dialog?.showSaveDialog) {
      item.cancel();
      return;
    }
    try {
      const parent = this.window && !this.window.isDestroyed?.() ? this.window : undefined;
      const result = await this.dialog.showSaveDialog(parent, {
        defaultPath: item.getFilename(),
      });
      if (result.canceled || !result.filePath) {
        item.cancel();
        return;
      }
      item.setSavePath(result.filePath);
      item.once('done', (_event, state) => {
        if (state === 'interrupted' && this.onError) {
          this.onError(this.t('download.interrupted', { filename: item.getFilename() }));
        }
      });
    } catch {
      // The item may already have finished while the dialog was open.
      try { item.cancel(); } catch {}
      if (this.onError) this.onError(this.t('download.noLocation'));
    }
  }

  async policyProxyConfig(port) {
    return this.browserSessionManager.policyProxyConfig(port);
  }

  async configure(port, { force = false } = {}) {
    return this.browserSessionManager.configure(port, { force });
  }

  suspendRoutingPolicy() {
    return this.browserSessionManager.suspend();
  }

  resumeRoutingPolicy(port = this.configuredPort) {
    return this.browserSessionManager.resume(port);
  }

  async refreshRoutingPolicy() {
    if (this.configuredPort) await this.configure(this.configuredPort, { force: true });
    this.updateAllTabRoutes();
    this.updateToolbar();
  }

  activeTab() {
    return this.tabManager.active();
  }

  cancelScheduledLayout() {
    if (this.scheduledLayout === null) return;
    clearImmediate(this.scheduledLayout);
    this.scheduledLayout = null;
  }

  scheduleLayout() {
    if (this.scheduledLayout !== null || !this.window || this.window.isDestroyed()) return;
    const scheduledWindow = this.window;
    this.scheduledLayout = setImmediate(() => {
      this.scheduledLayout = null;
      if (this.window !== scheduledWindow || scheduledWindow.isDestroyed()) return;
      this.applyLayout();
    });
    this.scheduledLayout.unref?.();
  }

  applyLayout() {
    const active = this.activeTab();
    if (!this.window || this.window.isDestroyed() || !active) return;
    if (active.view.webContents.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const toolbarHeight = TOOLBAR_HEIGHT + (this.findOpen ? FIND_BAR_HEIGHT : 0);
    active.view.setBounds({
      x: 0,
      y: toolbarHeight,
      width: Math.max(1, width),
      height: Math.max(1, height - toolbarHeight),
    });
  }

  layout() {
    this.cancelScheduledLayout();
    this.applyLayout();
  }

  currentUrl(tab) {
    if (!tab) return '';
    if (tab.failedUrl) return tab.failedUrl;
    if (tab.view.webContents.isDestroyed()) return '';
    try {
      const current = tab.view.webContents.getURL();
      return current.startsWith('data:') ? '' : current;
    } catch {
      return '';
    }
  }

  resolveRoute(rawUrl, inheritedRoute = null, requestedRoute = null) {
    if (rawUrl === BLANK_CAMPUS_HOME) {
      return { route: ROUTE_DIRECT, source: 'local-blank', matchedRule: null };
    }
    let resolution;
    try {
      resolution = this.routingPolicy.resolve(rawUrl, inheritedRoute);
    } catch {
      resolution = null;
    }
    if (!resolution || ![ROUTE_CAMPUS, ROUTE_DIRECT].includes(resolution.route)) {
      resolution = resolveDomainRouteForUrl(rawUrl, { inheritedRoute });
    }
    if (resolution.source === 'default' &&
        [ROUTE_CAMPUS, ROUTE_DIRECT].includes(requestedRoute)) {
      return { route: requestedRoute, source: 'requested', matchedRule: null };
    }
    return resolution;
  }

  updateTabRoute(tab, rawUrl = this.currentUrl(tab)) {
    if (!tab || !rawUrl) return null;
    const resolution = this.resolveRoute(rawUrl);
    tab.route = resolution.route;
    tab.routeSource = resolution.source;
    tab.matchedRule = resolution.matchedRule;
    return resolution;
  }

  updateAllTabRoutes() {
    for (const tab of this.tabs) {
      const url = this.currentUrl(tab) || tab.failedUrl;
      if (url) this.updateTabRoute(tab, url);
    }
  }

  cancelScheduledToolbarUpdate() {
    if (this.scheduledToolbarUpdate === null) return;
    clearImmediate(this.scheduledToolbarUpdate);
    this.scheduledToolbarUpdate = null;
  }

  scheduleToolbarUpdate() {
    if (this.scheduledToolbarUpdate !== null ||
        !this.window || this.window.isDestroyed()) return;
    const scheduledWindow = this.window;
    this.scheduledToolbarUpdate = setImmediate(() => {
      this.scheduledToolbarUpdate = null;
      if (this.window !== scheduledWindow || scheduledWindow.isDestroyed()) return;
      this.sendToolbarState();
    });
    this.scheduledToolbarUpdate.unref?.();
  }

  cancelScheduledUpdates() {
    this.cancelScheduledLayout();
    this.cancelScheduledToolbarUpdate();
  }

  sendToolbarState() {
    if (!this.window || this.window.isDestroyed()) return;
    const active = this.activeTab();
    // A crashed or closed renderer (e.g. the page died while the slow-load
    // timer was pending) must not take the main process down with it.
    if (active && active.view.webContents.isDestroyed()) return;
    const activeTitle = active?.view.webContents.getTitle() || '';
    const navigation = navigationForContents(active?.view.webContents);
    const state = {
      url: this.currentUrl(active),
      title: activeTitle,
      loading: !!active?.loading,
      slow: !!active?.slow,
      findOpen: this.findOpen,
      route: active?.route || ROUTE_CAMPUS,
      routeSource: active?.routeSource || 'default',
      routeLabel: active?.route === ROUTE_DIRECT ? this.t('route.direct') : this.t('route.campus'),
      canGoBack: !!active && navigation.canGoBack(),
      canGoForward: !!active && navigation.canGoForward(),
      activeTabId: this.activeTabId,
      tabs: this.tabs.map((tab) => ({
        id: tab.id,
        title: tab.view.webContents.isDestroyed()
          ? this.t('tab.new')
          : tab.view.webContents.getTitle() || this.t('tab.new'),
        loading: tab.loading,
        route: tab.route,
      })),
    };
    const serialized = JSON.stringify(state);
    if (serialized === this.lastToolbarState) return;
    const send = this.window.webContents?.send;
    if (typeof send !== 'function') return;
    try {
      send.call(this.window.webContents, 'campus-toolbar-state', state);
      this.lastToolbarState = serialized;
    } catch {
      // Window teardown can race the final page event. The closed handler also
      // cancels future updates, so there is nothing useful to surface here.
    }
  }

  updateToolbar() {
    this.cancelScheduledToolbarUpdate();
    this.sendToolbarState();
  }

  handleToolbarCommand(input) {
    const normalized = input && typeof input === 'object'
      ? normalizeToolbarCommand(input.command, input.value)
      : null;
    if (!normalized) return false;
    const { command, value } = normalized;
    const active = this.activeTab();
    const navigation = navigationForContents(active?.view.webContents);

    if (command === 'new-tab') this.createTab(this.homeUrl);
    else if (command === 'switch-tab') this.switchTab(Number(value));
    else if (command === 'close-tab') this.closeTab(Number(value));
    else if (command === 'set-route' && active) {
      this.setTabRoute(active.id, value).catch((error) => {
        if (this.onError) this.onError(this.t('route.switchFailed', { message: error.message }));
      });
    }
    else if (command === 'manage-credential' && active) {
      this.manageCredential(active);
    }
    else if (command === 'manage-routing-rules') {
      if (typeof this.onManageRoutingRules === 'function') this.onManageRoutingRules();
    }
    else if (command === 'back' && navigation.canGoBack()) {
      navigation.goBack();
    } else if (command === 'forward' && navigation.canGoForward()) {
      navigation.goForward();
    } else if (command === 'reload' && active) {
      active.failedUrl
        ? this.navigate(active.failedUrl, active)
        : active.view.webContents.reload();
    } else if (command === 'navigate' && active) {
      this.navigate(value, active);
    } else if (command === 'find-open') {
      this.setFindBar(true);
    } else if (command === 'find-close') {
      this.setFindBar(false);
    } else if (command === 'find' && active) {
      this.lastFindQuery = value;
      const contents = active.view.webContents;
      if (contents.isDestroyed()) return;
      if (value && typeof contents.findInPage === 'function') contents.findInPage(value);
      if (!value && typeof contents.stopFindInPage === 'function') {
        contents.stopFindInPage('clearSelection');
      }
    } else if ((command === 'find-next' || command === 'find-prev') &&
               active && this.lastFindQuery &&
               !active.view.webContents.isDestroyed() &&
               typeof active.view.webContents.findInPage === 'function') {
      active.view.webContents.findInPage(this.lastFindQuery, {
        forward: command === 'find-next',
        findNext: true,
      });
    }
    return true;
  }

  // The find bar is per-window: it stays open across tab switches, but matches
  // are per-tab, so a switched-to tab has no active find until the next search.
  setFindBar(open) {
    if (!this.window || this.window.isDestroyed()) return;
    this.findOpen = !!open;
    this.layout();
    this.updateToolbar();
    if (open) {
      this.window.webContents.send?.('campus-toolbar-focus', 'find');
      return;
    }
    const active = this.activeTab();
    if (active && !active.view.webContents.isDestroyed()) {
      if (typeof active.view.webContents.stopFindInPage === 'function') {
        active.view.webContents.stopFindInPage('clearSelection');
      }
      active.view.webContents.focus();
    }
  }

  clearSlowTimer(tab) {
    if (tab.slowTimer) {
      clearTimeout(tab.slowTimer);
      tab.slowTimer = null;
    }
    tab.slow = false;
  }

  attachPageEvents(tab) {
    const contents = tab.view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (safePopupUrl(url)) {
        const credentialReservation = this.credentialController.reservePopup(tab);
        setImmediate(() => {
          let popup = null;
          try {
            popup = this.createTab(url, this.resolveRoute(url).route, { credentialReservation });
          } catch {
            if (this.onError) this.onError(this.t('tab.createFailed'));
          } finally {
            if (!popup) this.credentialController.releasePopup(credentialReservation);
          }
        });
      }
      return { action: 'deny' };
    });
    const rejectNonWebNavigation = (event, url) => {
      if (!safePopupUrl(url)) event?.preventDefault?.();
    };
    // A compromised campus page cannot turn this isolated WebContents into a
    // file/custom-protocol reader. Cover both script/user navigations and HTTP
    // redirects; regular HTTP(S), fragment, and history navigation remain.
    contents.on('will-navigate', rejectNonWebNavigation);
    contents.on('will-redirect', rejectNonWebNavigation);
    contents.on('did-start-loading', () => {
      tab.loading = true;
      if (!tab.renderingError) tab.failedUrl = '';
      this.clearSlowTimer(tab);
      tab.slowTimer = setTimeout(() => {
        tab.slowTimer = null;
        tab.slow = true;
        this.scheduleToolbarUpdate();
      }, SLOW_LOADING_HINT_MS);
      tab.slowTimer.unref?.();
      this.scheduleToolbarUpdate();
    });
    contents.on('did-stop-loading', () => {
      tab.loading = false;
      tab.renderingError = false;
      this.clearSlowTimer(tab);
      this.scheduleToolbarUpdate();
    });
    contents.on('did-navigate', (_event, url, httpResponseCode = 0) => {
      this.markCredentialNavigation(tab, url, httpResponseCode);
      this.updateTabRoute(tab, url);
      this.scheduleToolbarUpdate();
    });
    for (const eventName of ['did-navigate-in-page', 'page-title-updated']) {
      contents.on(eventName, () => this.scheduleToolbarUpdate());
    }
    // Provisional failures (DNS, reset, timeout before the page commits) do not
    // fire did-fail-load; without this handler the tab stayed blank and the
    // failed URL was lost, so a route switch silently fell back to the school
    // home page instead of retrying the site the user asked for.
    const handleLoadFailure = (_event, code, description, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3 || !safePopupUrl(failedUrl)) return;
      tab.loading = false;
      tab.failedUrl = failedUrl;
      tab.renderingError = true;
      this.clearCredentialCandidate(tab);
      this.clearSlowTimer(tab);
      contents.loadURL(errorPage(failedUrl, description, this.t)).catch(() => {});
      this.scheduleToolbarUpdate();
    };
    contents.on('did-fail-load', handleLoadFailure);
    contents.on('did-fail-provisional-load', handleLoadFailure);
    contents.on('ipc-message', (_event, channel, candidate) => {
      if (channel === 'campus-credential-candidate') {
        this.credentialController.stage(tab, candidate);
      } else if (channel === 'campus-credential-page-state') {
        this.credentialController.confirmPageState(tab, candidate).catch(() => {});
      }
    });
    contents.on('render-process-gone', (_event, details) => {
      this.handleRendererCrash(tab, details);
    });
    contents.on('before-input-event', (event, input) => {
      const commandKey = process.platform === 'darwin' ? input.meta : input.control;
      const key = String(input.key || '').toLowerCase();
      const navigation = navigationForContents(contents);
      if (commandKey && key === 't') {
        event.preventDefault();
        this.createTab(this.homeUrl);
      } else if (commandKey && key === 'w') {
        event.preventDefault();
        this.closeTab(tab.id);
      } else if (commandKey && key === 'l') {
        event.preventDefault();
        this.window?.webContents.send?.('campus-toolbar-focus', 'address');
      } else if (commandKey && key === 'r') {
        event.preventDefault();
        tab.failedUrl ? this.navigate(tab.failedUrl, tab) : contents.reload();
      } else if (commandKey && key === 'f' && input.type === 'keyDown') {
        event.preventDefault();
        this.setFindBar(true);
      } else if (commandKey && ['=', '+', '-', '0'].includes(key) &&
                 input.type === 'keyDown') {
        event.preventDefault();
        contents.setZoomFactor(nextZoomFactor(contents.getZoomFactor(), key));
      } else if (input.alt && ['left', 'arrowleft'].includes(key) && navigation.canGoBack()) {
        event.preventDefault();
        navigation.goBack();
      } else if (input.alt && ['right', 'arrowright'].includes(key) && navigation.canGoForward()) {
        event.preventDefault();
        navigation.goForward();
      } else if (commandKey && /^[1-9]$/.test(key)) {
        event.preventDefault();
        const index = key === '9' ? this.tabs.length - 1 : Number(key) - 1;
        const selected = this.tabManager.at(index);
        if (selected) this.switchTab(selected.id);
      }
    });
  }

  tabOrigin(tab) {
    if (!tab || tab.view.webContents.isDestroyed()) return '';
    try {
      const parsed = new URL(tab.view.webContents.getURL());
      return parsed.protocol === 'https:' ? parsed.origin : '';
    } catch {
      return '';
    }
  }

  clearCredentialCandidate(tab) {
    this.credentialController.clear(tab);
  }

  stageCredentialCandidate(tab, candidate) {
    return this.credentialController.stage(tab, candidate);
  }

  markCredentialNavigation(tab, rawUrl, httpResponseCode = 0) {
    return this.credentialController.markNavigation(tab, rawUrl, httpResponseCode);
  }

  async confirmCredentialAfterPageState(tab, pageState) {
    return this.credentialController.confirmPageState(tab, pageState);
  }

  async offerCredential(candidate) {
    return this.credentialController.offer(candidate);
  }

  handleRendererCrash(tab, details = {}) {
    if (!tab || !this.tabManager.contains(tab) || tab.view.webContents.isDestroyed() ||
        details.reason === 'clean-exit') return;
    this.certificateController.cancelAll();
    const contents = tab.view.webContents;
    const failedUrl = this.currentUrl(tab) || this.homeUrl;
    const reason = String(details.reason || 'crashed').slice(0, 80);
    tab.loading = false;
    tab.failedUrl = safePopupUrl(failedUrl) ? failedUrl : this.homeUrl;
    tab.renderingError = true;
    tab.crashed = true;
    this.clearCredentialCandidate(tab);
    this.clearSlowTimer(tab);
    contents.loadURL(errorPage(
      tab.failedUrl,
      this.t('errorPage.rendererCrash', { reason }),
      this.t,
    )).catch(() => {
      if (this.onError) this.onError(this.t('errorPage.rendererCrash', { reason }));
    });
    this.scheduleToolbarUpdate();
  }

  async manageCredential(tab) {
    if (!this.credentialVault || !this.dialog) return;
    const origin = this.tabOrigin(tab);
    if (!origin) {
      if (this.onError) this.onError(this.t('cred.httpsOnly'));
      return;
    }
    try {
      const credential = await this.credentialVault.get(origin);
      if (!this.window || this.window.isDestroyed()) return;
      if (!credential) {
        await this.dialog.showMessageBox(this.window, {
          type: 'info',
          title: this.t('cred.title'),
          message: this.t('cred.noneMessage', { host: new URL(origin).hostname }),
          detail: this.t('cred.noneDetail'),
          buttons: [this.t('cred.ok')],
          noLink: true,
        });
        return;
      }
      const result = await this.dialog.showMessageBox(this.window, {
        type: 'question',
        title: this.t('cred.title'),
        message: this.t('cred.hasMessage', { host: new URL(origin).hostname }),
        detail: this.t('cred.hasDetail'),
        buttons: [this.t('cred.fill'), this.t('cred.delete'), this.t('common.cancel')],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (result.response === 0 && !tab.view.webContents.isDestroyed()) {
        tab.view.webContents.send('campus-credential-fill', credential);
      } else if (result.response === 1) {
        await this.credentialVault.remove(origin);
      }
    } catch {
      if (this.onError) this.onError(this.t('cred.readFailed'));
    }
  }

  createTab(rawUrl = null, route = null, options = {}) {
    if (!this.window || this.window.isDestroyed()) return null;
    const targetWindow = this.window;
    if (!this.tabManager.canAdd()) {
      if (this.onError) this.onError(this.t('tab.limit', { count: MAX_TABS }));
      return null;
    }
    let url;
    try {
      url = normalizeCampusUrl(rawUrl, this.homeUrl, this.t);
    } catch (error) {
      if (this.onError) this.onError(error.message);
      return null;
    }
    const routeSession = this.browserSessionManager.sessionForRoute(ROUTE_CAMPUS);
    if (!routeSession) return null;
    const resolution = this.resolveRoute(url, null, route);
    const previousActiveId = this.tabManager.activeTabId;
    let view = null;
    let tab = null;
    let added = false;
    try {
      view = new this.WebContentsView({
        webPreferences: {
          session: routeSession,
          preload: this.campusPreload,
          devTools: false,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          safeDialogs: true,
          backgroundThrottling: true,
        },
      });
      tab = {
        view,
        failedUrl: '',
        loading: false,
        slow: false,
        slowTimer: null,
        renderingError: false,
        crashed: false,
        pendingCredential: null,
        pendingCredentialTimer: null,
        route: resolution.route,
        routeSource: resolution.source,
        matchedRule: resolution.matchedRule,
      };
      this.credentialController.linkPopup(options.credentialReservation, tab);
      this.tabManager.add(tab);
      added = true;
      // A newly attached view is hidden until switchTab has applied the current
      // window bounds and made exactly one tab visible. This avoids a one-frame
      // flash where two renderer surfaces can both paint.
      view.setVisible(false);
      if (this.window !== targetWindow || targetWindow.isDestroyed()) {
        throw new Error('campus browser window closed during tab creation');
      }
      targetWindow.contentView.addChildView(view);
      this.attachPageEvents(tab);
      if (!this.switchTab(tab.id) || !this.navigate(url, tab)) {
        throw new Error('campus browser tab activation failed');
      }
      return tab;
    } catch {
      if (tab) this.credentialController.closeTab(tab);
      else this.credentialController.releasePopup(options.credentialReservation);
      if (added) this.tabManager.remove(tab.id);
      try { if (view) targetWindow.contentView.removeChildView(view); } catch {}
      try {
        if (view?.webContents && !view.webContents.isDestroyed()) view.webContents.close();
      } catch {}
      const previous = previousActiveId === null ? null : this.tabManager.select(previousActiveId);
      this.view = previous?.view || null;
      if (previous && this.window === targetWindow && !targetWindow.isDestroyed()) {
        try { previous.view.setVisible(true); this.layout(); } catch {}
        this.scheduleToolbarUpdate();
      }
      if (this.onError) this.onError(this.t('tab.createFailed'));
      return null;
    }
  }

  async setTabRoute(id, route) {
    if (![ROUTE_CAMPUS, ROUTE_DIRECT].includes(route)) return false;
    const tab = this.tabManager.find(id);
    if (!tab || !this.window || this.window.isDestroyed()) return false;
    // A route-switch request invalidates the in-flight page regardless of
    // whether reconnecting/configuring the requested route later succeeds.
    this.clearCredentialCandidate(tab);
    const url = this.currentUrl(tab) || this.homeUrl;
    let host;
    try {
      host = normalizeRuleHost(new URL(url).hostname);
    } catch {
      return false;
    }
    if (route === ROUTE_CAMPUS && !await this.ensureCampusReady()) return false;

    await this.routingPolicy.upsert({
      host,
      includeSubdomains: false,
      route,
    });
    if (this.routingPolicy.appliesLiveSession !== true) {
      await this.configure(this.configuredPort || 1080, { force: true });
    }
    this.clearSlowTimer(tab);
    this.updateAllTabRoutes();
    tab.route = route;
    tab.routeSource = 'user-exact';
    tab.matchedRule = { host, includeSubdomains: false };
    if (tab.failedUrl || tab.renderingError) {
      this.navigate(url, tab);
    } else if (!tab.view.webContents.isDestroyed()) {
      if (typeof tab.view.webContents.reloadIgnoringCache === 'function') {
        tab.view.webContents.reloadIgnoringCache();
      } else {
        tab.view.webContents.reload();
      }
    }
    this.scheduleToolbarUpdate();
    return true;
  }

  switchTab(id) {
    const selected = this.tabManager.select(id);
    if (!selected) return false;
    this.view = selected.view;
    this.layout();
    for (const tab of this.tabs) {
      if (tab.id !== selected.id) tab.view.setVisible(false);
    }
    selected.view.setVisible(true);
    this.scheduleToolbarUpdate();
    return true;
  }

  closeTab(id) {
    const removal = this.tabManager.remove(id);
    if (!removal) return false;
    this.cancelScheduledUpdates();
    this.certificateController.cancelAll();
    const { tab, replacement, empty } = removal;
    this.clearSlowTimer(tab);
    this.credentialController.closeTab(tab);
    this.window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();

    if (empty) {
      this.view = null;
      this.createTab(this.homeUrl, ROUTE_CAMPUS);
    } else if (replacement) {
      this.switchTab(replacement.id);
    } else {
      this.scheduleToolbarUpdate();
    }
    return true;
  }

  async createWindow() {
    this.cancelScheduledUpdates();
    this.lastToolbarState = null;
    this.window = new this.BrowserWindow({
      width: 1040,
      height: 740,
      minWidth: 660,
      minHeight: 460,
      title: this.t('browser.windowTitle'),
      backgroundColor: '#f7f9fc',
      autoHideMenuBar: true,
      ...campusWindowChrome(process.platform),
      parent: process.platform === 'darwin' ? undefined : this.parentWindow(),
      webPreferences: {
        preload: this.toolbarPreload,
        devTools: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        safeDialogs: true,
      },
    });
    await this.window.loadFile(this.toolbarFile, { query: { lang: this.locale } });
    this.window.webContents.on('ipc-message', (_event, channel, payload) => {
      if (channel === 'campus-toolbar-command') this.handleToolbarCommand(payload);
    });
    this.window.on('resize', () => this.scheduleLayout());
    this.window.on('closed', () => {
      this.cancelScheduledUpdates();
      this.certificateController.cancelAll();
      for (const tab of this.tabs) {
        this.clearSlowTimer(tab);
        this.clearCredentialCandidate(tab);
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      }
      this.tabManager.clear();
      this.view = null;
      this.window = null;
      this.findOpen = false;
      this.lastToolbarState = null;
    });
  }

  navigate(rawUrl, tab = this.activeTab()) {
    let url;
    try {
      url = normalizeCampusUrl(rawUrl, this.homeUrl, this.t);
    } catch (error) {
      if (this.onError) this.onError(error.message);
      return false;
    }
    if (!tab || tab.view.webContents.isDestroyed()) return false;
    this.updateTabRoute(tab, url);
    tab.failedUrl = '';
    tab.renderingError = false;
    tab.crashed = false;
    tab.view.webContents.loadURL(url).catch(() => {
      // did-fail-load renders a local error page. A superseded navigation can
      // reject this promise even though the newer page loaded successfully.
    });
    this.scheduleToolbarUpdate();
    return true;
  }

  async open(rawUrl, port, route = null) {
    const url = normalizeCampusUrl(rawUrl, this.homeUrl, this.t);
    const resolution = this.resolveRoute(url, null, route);
    if (resolution.route === ROUTE_CAMPUS && !await this.ensureCampusReady()) {
      throw new Error(this.t('error.connectTimeout'));
    }
    // ensureCampusReady() proves the current engine generation has reached its
    // listener-ready boundary. Only then may a Session suspended during a
    // previous disconnect be pointed back at the live loopback frontend.
    if (this.routingSuspended) await this.resumeRoutingPolicy(port);
    else await this.configure(port);
    if (!this.window || this.window.isDestroyed()) await this.createWindow();

    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
    this.createTab(url, resolution.route);
    return url;
  }

  close() {
    this.cancelScheduledUpdates();
    this.certificateController.cancelAll();
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
      return;
    }
    for (const tab of this.tabs) {
      this.clearSlowTimer(tab);
      this.clearCredentialCandidate(tab);
    }
    this.window = null;
    this.view = null;
    this.tabManager.clear();
    this.findOpen = false;
    this.lastToolbarState = null;
  }

  closeForContextSwitch({ timeoutMs = 5_000, setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000 ||
        typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
      return Promise.reject(new TypeError('Campus Browser close deadline is invalid'));
    }
    const window = this.window;
    if (!window || window.isDestroyed()) {
      this.close();
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (closed) => {
        if (settled) return;
        settled = true;
        clearTimeoutFn(timer);
        resolve(closed);
      };
      window.once('closed', () => finish(true));
      timer = setTimeoutFn(() => finish(false), timeoutMs);
      timer?.unref?.();
      try { window.close(); }
      catch { finish(false); }
    });
  }
}

module.exports = {
  CAMPUS_PARTITION,
  CampusBrowser,
  DEFAULT_CAMPUS_HOME,
  BLANK_CAMPUS_HOME,
  FIND_BAR_HEIGHT,
  MAX_TABS,
  SLOW_LOADING_HINT_MS,
  TOOLBAR_HEIGHT,
  applyCampusSessionPolicy,
  campusProxyConfig,
  campusWindowChrome,
  errorPage,
  nextZoomFactor,
  navigationForContents,
  normalizeCampusUrl,
  pacDataUrl,
  redactedFailedUrl,
  safePopupUrl,
};
