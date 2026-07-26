'use strict';

const DEFAULT_CAMPUS_HOME = 'https://www.hkust-gz.edu.cn/';
const CAMPUS_PARTITION = 'persist:hkustgz-campus-browser';
const TOOLBAR_HEIGHT = 76;
const MAX_URL_LENGTH = 2048;

function normalizeCampusUrl(input, fallback = DEFAULT_CAMPUS_HOME) {
  let value = String(input || '').trim() || fallback;
  if (value.length > MAX_URL_LENGTH) throw new Error('网址过长');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('网址格式不正确');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('校园浏览器只支持 HTTP 和 HTTPS 网址');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error('网址格式不正确');
  }
  return parsed.href;
}

function campusProxyConfig(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1025 || value > 65535) {
    throw new Error('本地代理端口无效');
  }
  return {
    mode: 'fixed_servers',
    proxyRules: `socks5://127.0.0.1:${value}`,
  };
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function errorPage(failedUrl, description) {
  const url = escapeHtml(failedUrl || '未知网址');
  const reason = escapeHtml(description || '网络请求失败');
  const html = `<!doctype html><meta charset="utf-8">
    <meta name="color-scheme" content="light">
    <title>校园网站无法打开</title>
    <style>
      body{margin:0;background:#f7f9fc;color:#1b2536;font-family:-apple-system,"PingFang SC","Segoe UI",sans-serif}
      main{max-width:560px;margin:12vh auto;padding:36px;background:#fff;border:1px solid #e8edf5;border-radius:18px;box-shadow:0 12px 30px rgba(13,30,66,.08)}
      h1{margin:0 0 14px;color:#0b2a5b;font-size:23px}p{line-height:1.7;color:#667085}
      code{display:block;margin-top:16px;padding:12px;background:#f4f7fb;border-radius:10px;word-break:break-all;color:#344054}
    </style>
    <main><h1>这个校园网站暂时无法打开</h1>
    <p>请确认 HKUST(GZ) Connect 仍为“已连接”，也可以检查网址后点击上方的重新加载。</p>
    <code>${url}</code><p>${reason}</p></main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

class CampusBrowser {
  constructor({
    BrowserWindow,
    WebContentsView,
    session,
    dialog,
    credentialVault,
    parentWindow,
    toolbarFile,
    campusPreload,
    onError,
  }) {
    this.BrowserWindow = BrowserWindow;
    this.WebContentsView = WebContentsView;
    this.session = session;
    this.dialog = dialog;
    this.credentialVault = credentialVault;
    this.parentWindow = parentWindow;
    this.toolbarFile = toolbarFile;
    this.campusPreload = campusPreload;
    this.onError = onError;
    this.window = null;
    this.view = null;
    this.tabs = [];
    this.activeTabId = null;
    this.nextTabId = 1;
    this.configuredPort = null;
    this.campusSession = null;
    this.credentialPrompts = new Set();
  }

  async configure(port) {
    const campusSession = this.session.fromPartition(CAMPUS_PARTITION);
    if (this.configuredPort !== port) {
      await campusSession.setProxy(campusProxyConfig(port));
      await campusSession.closeAllConnections();
      this.configuredPort = port;
    }
    this.campusSession = campusSession;
    return campusSession;
  }

  activeTab() {
    return this.tabs.find((tab) => tab.id === this.activeTabId) || null;
  }

  layout() {
    if (!this.window || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const bounds = {
      x: 0,
      y: TOOLBAR_HEIGHT,
      width: Math.max(1, width),
      height: Math.max(1, height - TOOLBAR_HEIGHT),
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
    const activeTitle = active?.view.webContents.getTitle() || '';
    const state = {
      url: this.currentUrl(active),
      title: activeTitle,
      loading: !!active?.loading,
      canGoBack: !!active && active.view.webContents.canGoBack(),
      canGoForward: !!active && active.view.webContents.canGoForward(),
      activeTabId: this.activeTabId,
      tabs: this.tabs.map((tab) => ({
        id: tab.id,
        title: tab.view.webContents.getTitle() || '新标签页',
        loading: tab.loading,
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

    if (command === 'new-tab') this.createTab(DEFAULT_CAMPUS_HOME);
    else if (command === 'switch-tab') this.switchTab(Number(value));
    else if (command === 'close-tab') this.closeTab(Number(value));
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
    }
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
      this.updateToolbar();
    });
    contents.on('did-stop-loading', () => {
      tab.loading = false;
      tab.renderingError = false;
      this.updateToolbar();
    });
    for (const eventName of ['did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
      contents.on(eventName, () => this.updateToolbar());
    }
    contents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3 || !safePopupUrl(failedUrl)) return;
      tab.loading = false;
      tab.failedUrl = failedUrl;
      tab.renderingError = true;
      contents.loadURL(errorPage(failedUrl, description)).catch(() => {});
      this.updateToolbar();
    });
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
        title: '保存校园网站密码',
        message: `要为 ${new URL(origin).hostname} 保存此登录信息吗？`,
        detail: '保存副本只加密存放在这台电脑上，不会额外上传给维护者或 GitHub。',
        buttons: ['保存', '暂不保存'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response === 0) {
        await this.credentialVault.save(origin, username, password);
      }
    } catch {
      if (this.onError) this.onError('网站密码无法写入本机安全存储');
    } finally {
      password = '';
      this.credentialPrompts.delete(origin);
    }
  }

  async manageCredential(tab) {
    if (!this.credentialVault || !this.dialog) return;
    const origin = this.tabOrigin(tab);
    if (!origin) {
      if (this.onError) this.onError('网站密码只适用于 HTTPS 页面');
      return;
    }
    try {
      const credential = await this.credentialVault.get(origin);
      if (!this.window || this.window.isDestroyed()) return;
      if (!credential) {
        await this.dialog.showMessageBox(this.window, {
          type: 'info',
          title: '网站密码',
          message: `${new URL(origin).hostname} 尚未保存密码`,
          detail: '在网站登录表单提交后，校园浏览器会询问是否保存在本机。',
          buttons: ['知道了'],
          noLink: true,
        });
        return;
      }
      const result = await this.dialog.showMessageBox(this.window, {
        type: 'question',
        title: '网站密码',
        message: `${new URL(origin).hostname} 已保存一个登录账号`,
        detail: '可以填入当前登录页，或只删除这个网站保存在本机的凭据。',
        buttons: ['填入登录页', '删除保存', '取消'],
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
      if (this.onError) this.onError('网站密码无法从本机安全存储读取');
    }
  }

  createTab(rawUrl = DEFAULT_CAMPUS_HOME) {
    if (!this.window || this.window.isDestroyed() || !this.campusSession) return null;
    let url;
    try {
      url = normalizeCampusUrl(rawUrl);
    } catch (error) {
      if (this.onError) this.onError(error.message);
      return null;
    }
    const view = new this.WebContentsView({
      webPreferences: {
        session: this.campusSession,
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
      renderingError: false,
    };
    this.tabs.push(tab);
    this.window.contentView.addChildView(view);
    this.attachPageEvents(tab);
    this.switchTab(tab.id);
    this.navigate(url, tab);
    return tab;
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
    this.window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();

    if (!this.tabs.length) {
      this.activeTabId = null;
      this.view = null;
      this.createTab(DEFAULT_CAMPUS_HOME);
    } else if (this.activeTabId === id) {
      const replacement = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.switchTab(replacement.id);
    } else {
      this.updateToolbar();
    }
    return true;
  }

  async createWindow(campusSession) {
    this.campusSession = campusSession;
    this.window = new this.BrowserWindow({
      width: 1040,
      height: 740,
      minWidth: 660,
      minHeight: 460,
      title: 'HKUST(GZ) 校园浏览器',
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
    await this.window.loadFile(this.toolbarFile);
    this.window.webContents.on('did-navigate-in-page', (_event, url) => {
      this.handleToolbarCommand(url);
    });
    this.window.on('resize', () => this.layout());
    this.window.on('closed', () => {
      for (const tab of this.tabs) {
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      }
      this.tabs = [];
      this.activeTabId = null;
      this.view = null;
      this.window = null;
    });
  }

  navigate(rawUrl, tab = this.activeTab()) {
    let url;
    try {
      url = normalizeCampusUrl(rawUrl);
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

  async open(rawUrl, port) {
    const url = normalizeCampusUrl(rawUrl);
    const campusSession = await this.configure(port);
    if (!this.window || this.window.isDestroyed()) await this.createWindow(campusSession);

    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
    this.createTab(url);
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
  TOOLBAR_HEIGHT,
  campusProxyConfig,
  campusWindowChrome,
  errorPage,
  normalizeCampusUrl,
  safePopupUrl,
};
