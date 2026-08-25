'use strict';

const { BLANK_CAMPUS_HOME, CampusBrowser, DEFAULT_CAMPUS_HOME } = require('./campus-browser');
const { CAMPUS_PARTITION } = require('./campus-route');
const { CampusCredentialVault } = require('./campus-credential-vault');
const { normalizeOpenRequest } = require('./campus-open-policy');

class CampusBrowserManager {
  constructor({
    BrowserWindow,
    WebContentsView,
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
    homeUrl = DEFAULT_CAMPUS_HOME,
    browserPartition = CAMPUS_PARTITION,
    routingPolicy,
    ensureCampusReady,
    resolveRoute,
    ensureConnected,
    getSocksPort,
    getLocale,
    getTranslator,
    showRoutingRules,
    reportError,
    CampusBrowserClass = CampusBrowser,
    CredentialVaultClass = CampusCredentialVault,
  } = {}) {
    for (const dependency of [
      BrowserWindow, WebContentsView, parentWindow, ensureCampusReady, resolveRoute,
      ensureConnected, getSocksPort, getLocale, getTranslator, showRoutingRules,
      reportError, CampusBrowserClass, CredentialVaultClass,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Campus Browser manager dependencies are incomplete');
      }
    }
    if (!session || !dialog || !safeStorage || !certificateTrust || !routingPolicy ||
        ![credentialFile, toolbarFile, toolbarPreload, campusPreload, browserPartition]
          .every((value) => typeof value === 'string' && value)) {
      throw new TypeError('Campus Browser manager environment is incomplete');
    }
    Object.assign(this, {
      BrowserWindow, WebContentsView, session, dialog, safeStorage, platform,
      credentialFile, certificateTrust, parentWindow, toolbarFile, toolbarPreload,
      campusPreload, homeUrl: homeUrl || BLANK_CAMPUS_HOME,
      routingPolicy, ensureCampusReady, resolveRoute, ensureConnected,
      browserPartition,
      getSocksPort, getLocale, getTranslator, showRoutingRules, reportError,
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
    // usable before credentials exist. Real HTTP(S) pages still establish the
    // tunnel up front until the request-boundary on-demand barrier can preserve
    // an original cross-origin SSO redirect without replaying it as a GET.
    if (request.url !== BLANK_CAMPUS_HOME) {
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

module.exports = { CampusBrowserManager };
