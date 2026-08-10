'use strict';

const { normalizeCertificateOrigin } = require('./campus-certificate-trust');

const CREDENTIAL_CANDIDATE_TTL_MS = 90 * 1000;
const MAX_USERNAME_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 4096;

function canonicalHttpsOrigin(value) {
  const origin = normalizeCertificateOrigin(value);
  return value === origin ? origin : '';
}

class CredentialController {
  constructor({
    vault,
    dialog,
    originForTab,
    windowForPrompt,
    t,
    onError,
    candidateTtlMs = CREDENTIAL_CANDIDATE_TTL_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    this.vault = vault;
    this.dialog = dialog;
    this.originForTab = typeof originForTab === 'function' ? originForTab : () => '';
    this.windowForPrompt = typeof windowForPrompt === 'function' ? windowForPrompt : () => null;
    this.t = typeof t === 'function' ? t : (key) => key;
    this.onError = typeof onError === 'function' ? onError : null;
    this.candidateTtlMs = Number.isFinite(candidateTtlMs) && candidateTtlMs > 0
      ? candidateTtlMs
      : CREDENTIAL_CANDIDATE_TTL_MS;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.prompts = new Set();
  }

  clear(tab) {
    if (!tab) return;
    if (tab.pendingCredentialTimer) {
      this.clearTimer(tab.pendingCredentialTimer);
      tab.pendingCredentialTimer = null;
    }
    if (tab.pendingCredential) tab.pendingCredential.password = '';
    tab.pendingCredential = null;
  }

  take(tab) {
    if (!tab?.pendingCredential) return null;
    if (tab.pendingCredentialTimer) {
      this.clearTimer(tab.pendingCredentialTimer);
      tab.pendingCredentialTimer = null;
    }
    const candidate = tab.pendingCredential;
    tab.pendingCredential = null;
    return candidate;
  }

  stage(tab, candidate) {
    if (!candidate || typeof candidate !== 'object') return false;
    const username = String(candidate.username || '');
    const password = String(candidate.password || '');
    // IPC gave the main process its own object copy. Retain the secret only in
    // the bounded controller record, not in both the event payload and record.
    try { candidate.password = ''; } catch {}
    if (!this.vault || !tab) return false;
    const currentOrigin = this.originForTab(tab);
    let origin;
    try {
      origin = canonicalHttpsOrigin(candidate.origin);
    } catch {
      return false;
    }
    if (!origin || !currentOrigin || origin !== currentOrigin || !password ||
        username.length > MAX_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return false;
    }

    this.clear(tab);
    tab.pendingCredential = {
      origin,
      username,
      password,
      navigationCommitted: false,
      navigationSuccessful: false,
      destinationOrigin: '',
    };
    tab.pendingCredentialTimer = this.setTimer(() => this.clear(tab), this.candidateTtlMs);
    tab.pendingCredentialTimer?.unref?.();
    return true;
  }

  markNavigation(tab, rawUrl, httpResponseCode = 0) {
    const pending = tab?.pendingCredential;
    if (!pending) return false;
    try {
      const parsed = new URL(String(rawUrl || ''));
      const status = Number(httpResponseCode);
      const successful = status === 0 || (status >= 200 && status < 400);
      // A password submitted on HTTPS must never survive an insecure
      // destination or an HTTP rejection such as 401/403.
      if (parsed.protocol !== 'https:' || !successful) {
        this.clear(tab);
        return false;
      }
      pending.navigationCommitted = true;
      pending.navigationSuccessful = true;
      pending.destinationOrigin = parsed.origin;
      return true;
    } catch {
      this.clear(tab);
      return false;
    }
  }

  async confirmPageState(tab, pageState) {
    const pending = tab?.pendingCredential;
    if (!pending || !pending.navigationCommitted || !pending.navigationSuccessful || !pageState ||
        typeof pageState !== 'object' || typeof pageState.hasLoginForm !== 'boolean') return false;
    let pageOrigin;
    try {
      pageOrigin = canonicalHttpsOrigin(pageState.origin);
    } catch {
      return false;
    }
    // A stale document can report state after a newer navigation. Ignore it;
    // the bounded candidate timer will clean up if no matching page arrives.
    if (!pageOrigin || pageOrigin !== this.originForTab(tab) ||
        pending.destinationOrigin !== pageOrigin) return false;
    if (pageState.hasLoginForm) {
      this.clear(tab);
      return false;
    }

    const candidate = this.take(tab);
    if (!candidate) return false;
    await this.offer(candidate);
    return true;
  }

  async offer(candidate) {
    if (!candidate || typeof candidate !== 'object') return false;
    let origin = '';
    let password = String(candidate.password || '');
    let ownsPrompt = false;
    try {
      if (!this.vault || !this.dialog?.showMessageBox) return false;
      try {
        origin = canonicalHttpsOrigin(candidate.origin);
      } catch {
        return false;
      }
      const username = String(candidate.username || '');
      if (!origin || !password || username.length > MAX_USERNAME_LENGTH ||
          password.length > MAX_PASSWORD_LENGTH || this.prompts.has(origin)) return false;

      this.prompts.add(origin);
      ownsPrompt = true;
      const existing = await this.vault.get(origin);
      if (existing?.username === username && existing.password === password) return true;
      const parent = this.windowForPrompt();
      if (!parent || parent.isDestroyed?.()) return false;
      const result = await this.dialog.showMessageBox(parent, {
        type: 'question',
        title: this.t('cred.saveTitle'),
        message: this.t('cred.saveMessage', { host: new URL(origin).hostname }),
        detail: this.t('cred.saveDetail'),
        buttons: [this.t('cred.save'), this.t('cred.later')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result?.response === 0) await this.vault.save(origin, username, password);
      return true;
    } catch {
      if (this.onError) this.onError(this.t('cred.writeFailed'));
      return false;
    } finally {
      password = '';
      candidate.password = '';
      if (ownsPrompt) this.prompts.delete(origin);
    }
  }
}

module.exports = {
  CREDENTIAL_CANDIDATE_TTL_MS,
  CredentialController,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  canonicalHttpsOrigin,
};
