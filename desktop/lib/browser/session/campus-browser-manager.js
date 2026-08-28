'use strict';

const { BLANK_CAMPUS_HOME, CampusBrowser } = require('./campus-browser');
const { ROUTE_CAMPUS } = require('../../routing/policy/campus-route');
const { CampusCredentialVault } = require('../credentials/campus-credential-vault');
const { normalizeOpenRequest } = require('../resources/campus-open-policy');
const { CampusWorkspaceController } = require('../workspace/campus-workspace-controller');

function browserProfilePresentation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.schoolName !== 'string' || !value.schoolName.trim() ||
      value.schoolName.length > 160 || /[\u0000-\u001f\u007f<>]/u.test(value.schoolName) ||
      typeof value.unverified !== 'boolean' ||
      (value.officialPortalResourceId != null &&
       (typeof value.officialPortalResourceId !== 'string' ||
        !/^[a-z0-9-]{1,40}$/u.test(value.officialPortalResourceId)))) {
    throw new TypeError('Campus Browser Profile presentation is invalid');
  }
  return Object.freeze({
    schoolName: value.schoolName.trim(),
    unverified: value.unverified,
    officialPortalResourceId: value.officialPortalResourceId || null,
  });
}

class CampusBrowserManager {
  constructor({
    BrowserWindow,
    WebContentsView,
    Menu,
    session,
    dialog,
    safeStorage,
    platform,
    credentialFile,
    certificateTrust,
    parentWindow,
    toolbarFile,
    toolbarPreload,
    campusPreload,
    workspaceFile,
    workspacePreload,
    homeUrl = BLANK_CAMPUS_HOME,
    browserPartition,
    routingPolicy,
    ensureCampusReady,
    resolveRoute,
    ensureConnected,
    getSocksPort,
    getLocale,
    getTranslator,
    getProfilePresentation,
    getWorkspaceResources,
    getWorkspaceGroups = () => [],
    onTogglePageFavorite,
    onOpenResource,
    onWorkspaceMutation,
    onRecordPageOpen,
    showItemInFolder,
    openExternal,
    showRoutingRules,
    reportError,
    CampusBrowserClass = CampusBrowser,
    CredentialVaultClass = CampusCredentialVault,
  } = {}) {
    for (const dependency of [
      BrowserWindow, WebContentsView, parentWindow, ensureCampusReady, resolveRoute,
      ensureConnected, getSocksPort, getLocale, getTranslator, getProfilePresentation,
      getWorkspaceResources, getWorkspaceGroups, onOpenResource, onWorkspaceMutation,
      showItemInFolder,
      showRoutingRules,
      reportError, CampusBrowserClass, CredentialVaultClass,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Campus Browser manager dependencies are incomplete');
      }
    }
    if (!session || !dialog || !safeStorage || !certificateTrust || !routingPolicy ||
        ![credentialFile, toolbarFile, toolbarPreload, campusPreload, workspaceFile,
          workspacePreload, browserPartition]
          .every((value) => typeof value === 'string' && value)) {
      throw new TypeError('Campus Browser manager environment is incomplete');
    }
    Object.assign(this, {
      BrowserWindow, WebContentsView, Menu, session, dialog, safeStorage, platform,
      credentialFile, certificateTrust, parentWindow, toolbarFile, toolbarPreload,
      campusPreload, workspaceFile, workspacePreload, homeUrl: homeUrl || BLANK_CAMPUS_HOME,
      routingPolicy, ensureCampusReady, resolveRoute, ensureConnected,
      browserPartition,
      getSocksPort, getLocale, getTranslator, getProfilePresentation, showItemInFolder,
      getWorkspaceResources, getWorkspaceGroups, onOpenResource, onWorkspaceMutation,
      onTogglePageFavorite: typeof onTogglePageFavorite === 'function'
        ? onTogglePageFavorite : async () => ({ ok: false }),
      onRecordPageOpen: typeof onRecordPageOpen === 'function' ? onRecordPageOpen : () => false,
      showRoutingRules, reportError,
      openExternal,
      CampusBrowserClass, CredentialVaultClass,
    });
    this.browser = null;
  }

  get routingSuspended() { return this.browser?.routingSuspended === true; }

  get routingRequestsBlocked() { return this.browser?.routingRequestsBlocked; }

  get hasBrowser() { return this.browser !== null; }

  getOrCreate() {
    if (this.browser) return this.browser;
    const credentialVault = new this.CredentialVaultClass({
      filePath: this.credentialFile,
      safeStorage: this.safeStorage,
      platform: this.platform,
    });
    const workspaceController = new CampusWorkspaceController({
      workspaceFile: this.workspaceFile,
      workspacePreload: this.workspacePreload,
      getProfilePresentation: () => browserProfilePresentation(this.getProfilePresentation()),
      getResources: () => this.getWorkspaceResources(),
      getGroups: () => this.getWorkspaceGroups(),
      getLocale: this.getLocale,
      onCommand: async (command) => {
        if (command.command === 'focus-address') return { ok: this.browser?.focusAddressBar() === true };
        if (command.command === 'open-resource') return this.onOpenResource(command.resourceId);
        if (command.command === 'manage-rules') return this.showRoutingRules();
        const result = await this.onWorkspaceMutation(command);
        this.browser?.updateToolbar();
        return result;
      },
    });
    this.browser = new this.CampusBrowserClass({
      BrowserWindow: this.BrowserWindow,
      WebContentsView: this.WebContentsView,
      session: this.session,
      dialog: this.dialog,
      certificateTrust: this.certificateTrust,
      credentialVault,
      parentWindow: this.parentWindow,
      toolbarFile: this.toolbarFile,
      toolbarPreload: this.toolbarPreload,
      campusPreload: this.campusPreload,
      profilePresentation: browserProfilePresentation(this.getProfilePresentation()),
      getWorkspaceResources: () => this.getWorkspaceResources(),
      getWorkspaceGroups: () => this.getWorkspaceGroups(),
      onOpenResource: (resourceId) => this.onOpenResource(resourceId),
      showBookmarkMenu: (entries) => this.popupBookmarkMenu(entries),
      onTogglePageFavorite: (candidate) => this.onTogglePageFavorite(candidate),
      workspaceController,
      onRecordPageOpen: (url) => this.onRecordPageOpen(url),
      showItemInFolder: this.showItemInFolder,
      openExternal: this.openExternal,
      homeUrl: this.homeUrl,
      partition: this.browserPartition,
      routingPolicy: this.routingPolicy,
      ensureCampusReady: this.ensureCampusReady,
      onManageRoutingRules: this.showRoutingRules,
      locale: this.getLocale(),
      t: this.getTranslator(),
      onError: this.reportError,
    });
    return this.browser;
  }

  async open(rawRequest) {
    const translate = this.getTranslator();
    let request;
    try {
      request = normalizeOpenRequest(rawRequest, translate, this.homeUrl);
    } catch (error) {
      this.reportError(error.message);
      return { ok: false, error: error.message };
    }
    if (request.url !== BLANK_CAMPUS_HOME) {
      try {
        request.route = this.resolveRoute(request.url).route;
      } catch (error) {
        const message = error.userMessage || error.message;
        this.reportError(message);
        return { ok: false, error: message };
      }
    }
    // The local custom-Profile landing page has no network request and must be
    // usable before credentials exist. Direct resources also need no Engine;
    // campus pages still establish the tunnel up front so an original
    // cross-origin SSO redirect is never replayed as a GET.
    if (request.url !== BLANK_CAMPUS_HOME && request.route === ROUTE_CAMPUS) {
      const connection = await this.ensureConnected();
      if (!connection?.ok) {
        const error = connection?.error || translate('error.connectTimeout');
        this.reportError(error);
        return { ok: false, error };
      }
    }
    try {
      await this.getOrCreate().open(request.url, this.getSocksPort(), request.route);
      return { ok: true, url: request.url, route: request.route };
    } catch (error) {
      const message = error.code === 'SETTINGS_READ_FAILED'
        ? error.message
        : translate('error.browserStart', { message: error.message });
      this.reportError(message);
      return { ok: false, error: message };
    }
  }

  async openBookmarkManager() {
    const result = await this.open();
    if (result?.ok) this.browser?.focusWorkspace('manage');
    return result;
  }

  popupBookmarkMenu(entries) {
    if (!this.Menu?.buildFromTemplate || !Array.isArray(entries) || !entries.length) return false;
    const item = (entry) => entry.type === 'folder'
      ? { label: entry.name, submenu: entry.children.map(item) }
      : { label: entry.name, click: () => Promise.resolve(this.onOpenResource(entry.id)).catch(() => {}) };
    this.Menu.buildFromTemplate(entries.map(item)).popup({ window: this.browser?.window || undefined });
    return true;
  }

  suspendRoutingPolicy() {
    return this.browser?.suspendRoutingPolicy() ?? null;
  }

  resumeRoutingPolicy(port) {
    return this.browser?.resumeRoutingPolicy(port) ?? null;
  }

  close() {
    const browser = this.browser;
    this.browser = null;
    return browser?.close() ?? null;
  }

  async closeForContextSwitch() {
    const browser = this.browser;
    if (!browser) return true;
    if (typeof browser.closeForContextSwitch !== 'function') return false;
    if (await browser.closeForContextSwitch() !== true) return false;
    if (this.browser === browser) this.browser = null;
    return this.browser === null;
  }

  async clearSiteData() {
    if (await this.closeForContextSwitch() !== true) return false;
    const target = this.session.fromPartition?.(this.browserPartition);
    if (!target || typeof target.clearStorageData !== 'function' ||
        typeof target.clearCache !== 'function') return false;
    await target.closeAllConnections?.();
    await target.clearStorageData();
    await target.clearCache();
    return true;
  }

  ownsWebContents(contents) {
    return this.browser?.ownsWebContents(contents) === true;
  }

  handleCertificateError(details) {
    return this.browser?.handleCertificateError(details);
  }

  setLocale(locale, translate) {
    this.browser?.setLocale(locale, translate);
  }
}

module.exports = { CampusBrowserManager, browserProfilePresentation };
