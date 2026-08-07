'use strict';

const DEFAULT_CAMPUS_HOME = 'https://www.hkust-gz.edu.cn/';
const {
  CAMPUS_PARTITION,
  ROUTE_CAMPUS,
  ROUTE_DIRECT,
  partitionForRoute,
  proxyConfigForRoute,
  routeForUrl,
} = require('./campus-route');
const {
  certificateFingerprint,
  normalizeCertificateOrigin,
} = require('./campus-certificate-trust');
const { createT } = require('./i18n');
const TOOLBAR_HEIGHT = 76;
const FIND_BAR_HEIGHT = 34;
const SLOW_LOADING_HINT_MS = 10000;
const MAX_URL_LENGTH = 2048;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;

function normalizeCampusUrl(input, fallback = DEFAULT_CAMPUS_HOME, t = createT('zh')) {
  let value = String(input || '').trim() || fallback;
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

function campusProxyConfig(port) {
  return proxyConfigForRoute(ROUTE_CAMPUS, port);
}

// A campus web page is untrusted content. Nothing it renders needs the camera,
// microphone, location, notifications, or a USB/serial device, so every request
// is refused without prompting the user.
function applyCampusSessionPolicy(campusSession) {
  if (typeof campusSession.setPermissionRequestHandler === 'function') {
    campusSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  }
  if (typeof campusSession.setPermissionCheckHandler === 'function') {
    campusSession.setPermissionCheckHandler(() => false);
  }
  if (typeof campusSession.setDevicePermissionHandler === 'function') {
    campusSession.setDevicePermissionHandler(() => false);
  }
  return campusSession;
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

function certificateTime(value, locale = 'zh', t = createT('zh')) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return t('cert.unknown');
  try {
    return new Date(seconds * 1000).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN', { hour12: false });
  } catch {
    return t('cert.unknown');
  }
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

function errorPage(failedUrl, description, t = createT('zh')) {
  const url = escapeHtml(failedUrl || t('errorPage.unknownUrl'));
  const reason = escapeHtml(description || t('errorPage.networkFailed'));
  const html = `<!doctype html><meta charset="utf-8">
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
    campusPreload,
    locale,
    t,
    onError,
  }) {
    this.BrowserWindow = BrowserWindow;
    this.WebContentsView = WebContentsView;
    this.session = session;
    this.dialog = dialog;
    this.certificateTrust = certificateTrust;
    this.credentialVault = credentialVault;
    this.parentWindow = parentWindow;
    this.toolbarFile = toolbarFile;
    this.campusPreload = campusPreload;
    this.locale = locale === 'en' ? 'en' : 'zh';
    this.t = typeof t === 'function' ? t : createT(this.locale);
    this.onError = onError;
    this.window = null;
    this.view = null;
    this.tabs = [];
    this.activeTabId = null;
    this.nextTabId = 1;
    this.configuredPort = null;
    this.sessions = new Map();
    this.sessionKeys = new Map();
    this.campusSession = null;
    this.credentialPrompts = new Set();
    this.downloadSessions = new Set();
    this.findOpen = false;
    this.lastFindQuery = '';
  }

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
    this.window.webContents.executeJavaScript(
      `window.campusBrowserUI&&window.campusBrowserUI.setLocale(${JSON.stringify(this.locale)})`,
    ).catch(() => {});
    this.updateToolbar();
  }

  async handleCertificateError({ url, error, certificate, callback }) {
    let settled = false;
    const finish = (allowed) => {
      if (settled) return;
      settled = true;
      if (typeof callback === 'function') callback(allowed);
    };
    try {
      const origin = normalizeCertificateOrigin(url);
      const fingerprint = certificateFingerprint(certificate?.data);
      if (this.certificateTrust?.isTrusted?.(origin, fingerprint)) {
        finish(true);
        return true;
      }
      if (!this.dialog?.showMessageBox || !this.certificateTrust?.trust) {
        finish(false);
        return false;
      }
      const detail = [
        this.t('cert.site', { origin }),
        this.t('cert.chromiumError', { error: String(error || this.t('cert.unknown')) }),
        this.t('cert.subject', { subject: String(certificate?.subjectName || this.t('cert.unknown')) }),
        this.t('cert.issuer', { issuer: String(certificate?.issuerName || this.t('cert.unknown')) }),
        this.t('cert.validity', {
          start: certificateTime(certificate?.validStart, this.locale, this.t),
          end: certificateTime(certificate?.validExpiry, this.locale, this.t),
        }),
        this.t('cert.fingerprint', { fingerprint }),
        '',
        this.t('cert.scope'),
      ].join('\n');
      const parent = this.window && !this.window.isDestroyed?.() ? this.window : undefined;
      const result = await this.dialog.showMessageBox(parent, {
        type: 'warning',
        title: this.t('cert.title'),
        message: this.t('cert.message', { origin }),
        detail,
        buttons: [this.t('cert.trust'), this.t('common.cancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (result?.response !== 0) {
        finish(false);
        return false;
      }
      this.certificateTrust.trust(origin, fingerprint);
      finish(true);
      return true;
    } catch {
      finish(false);
      return false;
    }
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

  async configure(port, route = ROUTE_CAMPUS) {
    const partition = partitionForRoute(route);
    const routeSession = applyCampusSessionPolicy(this.session.fromPartition(partition));
    this.applyDownloadHandler(routeSession);
    const key = route === ROUTE_DIRECT ? route : `${route}:${port}`;
    if (this.sessionKeys.get(route) !== key) {
      await routeSession.setProxy(proxyConfigForRoute(route, port));
      await routeSession.closeAllConnections();
      this.sessionKeys.set(route, key);
    }
    this.sessions.set(route, routeSession);
    if (route === ROUTE_CAMPUS) {
      this.configuredPort = port;
      this.campusSession = routeSession;
    }
    return routeSession;
  }

  activeTab() {
    return this.tabs.find((tab) => tab.id === this.activeTabId) || null;
  }

  layout() {
    if (!this.window || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const toolbarHeight = TOOLBAR_HEIGHT + (this.findOpen ? FIND_BAR_HEIGHT : 0);
    const bounds = {
      x: 0,
      y: toolbarHeight,
      width: Math.max(1, width),
      height: Math.max(1, height - toolbarHeight),
    };
    for (const tab of this.tabs) tab.view.setBounds(bounds);
  }

  currentUrl(tab) {
    if (!tab) return '';
    if (tab.failedUrl) return tab.failedUrl;
    if (tab.view.webContents.isDestroyed()) return '';
    const current = tab.view.webContents.getURL();
    return current.startsWith('data:') ? '' : current;
  }

  updateToolbar() {
    if (!this.window || this.window.isDestroyed()) return;
    const active = this.activeTab();
    // A crashed or closed renderer (e.g. the page died while the slow-load
    // timer was pending) must not take the main process down with it.
    if (active && active.view.webContents.isDestroyed()) return;
    const activeTitle = active?.view.webContents.getTitle() || '';
    const state = {
      url: this.currentUrl(active),
      title: activeTitle,
      loading: !!active?.loading,
      slow: !!active?.slow,
      findOpen: this.findOpen,
      route: active?.route || ROUTE_CAMPUS,
      routeLabel: active?.route === ROUTE_DIRECT ? this.t('route.direct') : this.t('route.campus'),
      canGoBack: !!active && active.view.webContents.canGoBack(),
      canGoForward: !!active && active.view.webContents.canGoForward(),
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
    const script = `window.campusBrowserUI&&window.campusBrowserUI.setState(${JSON.stringify(state)})`;
    this.window.webContents.executeJavaScript(script).catch(() => {});
  }

  handleToolbarCommand(target) {
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return;
    }
    const values = new URLSearchParams(parsed.hash.slice(1));
    const command = values.get('command') || '';
    const value = values.get('value') || '';
    const active = this.activeTab();

    if (command === 'new-tab') this.createTab(DEFAULT_CAMPUS_HOME, ROUTE_CAMPUS);
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
    else if (command === 'back' && active?.view.webContents.canGoBack()) {
      active.view.webContents.goBack();
    } else if (command === 'forward' && active?.view.webContents.canGoForward()) {
      active.view.webContents.goForward();
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
  }

  // The find bar is per-window: it stays open across tab switches, but matches
  // are per-tab, so a switched-to tab has no active find until the next search.
  setFindBar(open) {
    if (!this.window || this.window.isDestroyed()) return;
    this.findOpen = !!open;
    this.layout();
    this.updateToolbar();
    if (open) {
      this.window.webContents.executeJavaScript(
        'window.campusBrowserUI&&window.campusBrowserUI.focusFind()',
      ).catch(() => {});
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
      if (safePopupUrl(url)) setImmediate(() => this.createTab(url));
      return { action: 'deny' };
    });
    contents.on('did-start-loading', () => {
      tab.loading = true;
      if (!tab.renderingError) tab.failedUrl = '';
      this.clearSlowTimer(tab);
      tab.slowTimer = setTimeout(() => {
        tab.slowTimer = null;
        tab.slow = true;
        this.updateToolbar();
      }, SLOW_LOADING_HINT_MS);
      tab.slowTimer.unref?.();
      this.updateToolbar();
    });
    contents.on('did-stop-loading', () => {
      tab.loading = false;
      tab.renderingError = false;
      this.clearSlowTimer(tab);
      this.updateToolbar();
    });
    for (const eventName of ['did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
      contents.on(eventName, () => this.updateToolbar());
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
      this.clearSlowTimer(tab);
      contents.loadURL(errorPage(failedUrl, description, this.t)).catch(() => {});
      this.updateToolbar();
    };
    contents.on('did-fail-load', handleLoadFailure);
    contents.on('did-fail-provisional-load', handleLoadFailure);
    contents.on('ipc-message', (_event, channel, candidate) => {
      if (channel === 'campus-credential-candidate') {
        this.offerCredential(tab, candidate);
      }
    });
    contents.on('before-input-event', (event, input) => {
      const commandKey = process.platform === 'darwin' ? input.meta : input.control;
      const key = String(input.key || '').toLowerCase();
      if (commandKey && key === 't') {
        event.preventDefault();
        this.createTab(DEFAULT_CAMPUS_HOME);
      } else if (commandKey && key === 'w') {
        event.preventDefault();
        this.closeTab(tab.id);
      } else if (commandKey && key === 'l') {
        event.preventDefault();
        this.window?.webContents.executeJavaScript(
          'window.campusBrowserUI&&window.campusBrowserUI.focusAddress()',
        ).catch(() => {});
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
      } else if (input.alt && ['left', 'arrowleft'].includes(key) && contents.canGoBack()) {
        event.preventDefault();
        contents.goBack();
      } else if (input.alt && ['right', 'arrowright'].includes(key) && contents.canGoForward()) {
        event.preventDefault();
        contents.goForward();
      } else if (commandKey && /^[1-9]$/.test(key)) {
        event.preventDefault();
        const index = key === '9' ? this.tabs.length - 1 : Number(key) - 1;
        const selected = this.tabs[index];
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

  async offerCredential(tab, candidate) {
    if (!this.credentialVault || !this.dialog || !candidate ||
        typeof candidate !== 'object') return;
    const origin = this.tabOrigin(tab);
    const username = String(candidate.username || '');
    let password = String(candidate.password || '');
    if (!origin || candidate.origin !== origin || !password ||
        username.length > 320 || password.length > 4096 ||
        this.credentialPrompts.has(origin)) return;

    this.credentialPrompts.add(origin);
    try {
      const existing = await this.credentialVault.get(origin);
      if (existing?.username === username && existing.password === password) return;
      if (!this.window || this.window.isDestroyed()) return;
      const result = await this.dialog.showMessageBox(this.window, {
        type: 'question',
        title: this.t('cred.saveTitle'),
        message: this.t('cred.saveMessage', { host: new URL(origin).hostname }),
        detail: this.t('cred.saveDetail'),
        buttons: [this.t('cred.save'), this.t('cred.later')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response === 0) {
        await this.credentialVault.save(origin, username, password);
      }
    } catch {
      if (this.onError) this.onError(this.t('cred.writeFailed'));
    } finally {
      password = '';
      this.credentialPrompts.delete(origin);
    }
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

  createTab(rawUrl = DEFAULT_CAMPUS_HOME, route = routeForUrl(rawUrl)) {
    if (!this.window || this.window.isDestroyed()) return null;
    let url;
    try {
      url = normalizeCampusUrl(rawUrl, undefined, this.t);
    } catch (error) {
      if (this.onError) this.onError(error.message);
      return null;
    }
    const routeSession = this.sessions.get(route);
    if (!routeSession) return null;
    const view = new this.WebContentsView({
      webPreferences: {
        session: routeSession,
        preload: this.campusPreload,
        devTools: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        safeDialogs: true,
      },
    });
    const tab = {
      id: this.nextTabId++,
      view,
      failedUrl: '',
      loading: false,
      slow: false,
      slowTimer: null,
      renderingError: false,
      route,
    };
    this.tabs.push(tab);
    this.window.contentView.addChildView(view);
    this.attachPageEvents(tab);
    this.switchTab(tab.id);
    this.navigate(url, tab);
    return tab;
  }

  async setTabRoute(id, route) {
    if (![ROUTE_CAMPUS, ROUTE_DIRECT].includes(route)) return false;
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab || tab.route === route || !this.window || this.window.isDestroyed()) return false;
    const url = this.currentUrl(tab) || DEFAULT_CAMPUS_HOME;
    await this.configure(this.configuredPort || 1080, route);
    this.clearSlowTimer(tab);
    const oldView = tab.view;
    this.window.contentView.removeChildView(oldView);
    if (!oldView.webContents.isDestroyed()) oldView.webContents.close();
    const view = new this.WebContentsView({
      webPreferences: {
        session: this.sessions.get(route),
        preload: this.campusPreload,
        devTools: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        safeDialogs: true,
      },
    });
    tab.view = view;
    tab.route = route;
    this.window.contentView.addChildView(view);
    this.attachPageEvents(tab);
    this.switchTab(tab.id);
    this.navigate(url, tab);
    return true;
  }

  switchTab(id) {
    const selected = this.tabs.find((tab) => tab.id === id);
    if (!selected) return false;
    this.activeTabId = id;
    this.view = selected.view;
    for (const tab of this.tabs) tab.view.setVisible(tab.id === id);
    this.layout();
    this.updateToolbar();
    return true;
  }

  closeTab(id) {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return false;
    const [tab] = this.tabs.splice(index, 1);
    this.clearSlowTimer(tab);
    this.window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();

    if (!this.tabs.length) {
      this.activeTabId = null;
      this.view = null;
      this.createTab(DEFAULT_CAMPUS_HOME, ROUTE_CAMPUS);
    } else if (this.activeTabId === id) {
      const replacement = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.switchTab(replacement.id);
    } else {
      this.updateToolbar();
    }
    return true;
  }

  async createWindow() {
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
        devTools: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        safeDialogs: true,
      },
    });
    await this.window.loadFile(this.toolbarFile, { query: { lang: this.locale } });
    this.window.webContents.on('did-navigate-in-page', (_event, url) => {
      this.handleToolbarCommand(url);
    });
    this.window.on('resize', () => this.layout());
    this.window.on('closed', () => {
      for (const tab of this.tabs) {
        this.clearSlowTimer(tab);
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      }
      this.tabs = [];
      this.activeTabId = null;
      this.view = null;
      this.window = null;
      this.findOpen = false;
    });
  }

  navigate(rawUrl, tab = this.activeTab()) {
    let url;
    try {
      url = normalizeCampusUrl(rawUrl, undefined, this.t);
    } catch (error) {
      if (this.onError) this.onError(error.message);
      return false;
    }
    if (!tab || tab.view.webContents.isDestroyed()) return false;
    tab.failedUrl = '';
    tab.renderingError = false;
    tab.view.webContents.loadURL(url).catch(() => {
      // did-fail-load renders a local error page. A superseded navigation can
      // reject this promise even though the newer page loaded successfully.
    });
    return true;
  }

  async open(rawUrl, port, route = routeForUrl(rawUrl)) {
    const url = normalizeCampusUrl(rawUrl, undefined, this.t);
    const selectedRoute = [ROUTE_CAMPUS, ROUTE_DIRECT].includes(route)
      ? route
      : routeForUrl(url);
    await this.configure(port, selectedRoute);
    if (!this.window || this.window.isDestroyed()) await this.createWindow();

    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
    this.createTab(url, selectedRoute);
    return url;
  }

  close() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
      return;
    }
    this.window = null;
    this.view = null;
    this.tabs = [];
    this.activeTabId = null;
  }
}

module.exports = {
  CAMPUS_PARTITION,
  CampusBrowser,
  DEFAULT_CAMPUS_HOME,
  FIND_BAR_HEIGHT,
  SLOW_LOADING_HINT_MS,
  TOOLBAR_HEIGHT,
  applyCampusSessionPolicy,
  campusProxyConfig,
  campusWindowChrome,
  errorPage,
  nextZoomFactor,
  normalizeCampusUrl,
  safePopupUrl,
};
