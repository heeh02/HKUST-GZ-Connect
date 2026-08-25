'use strict';

const { normalizeCertificateOrigin } = require('./browser/certificates/campus-certificate-trust');

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
    // Popup tabs borrow only an opaque owner relationship. The staged password
    // remains on exactly one owner tab and is never copied into popup state.
    this.popupOwners = new WeakMap();
    this.popupFlows = new WeakMap();
    this.popupNavigation = new WeakMap();
    this.navigationSequence = 0;
  }

  ownerTab(tab) {
    return this.popupOwners.get(tab) || tab;
  }

  flowFor(owner, create = false) {
    let flow = owner ? this.popupFlows.get(owner) : null;
    if (!flow && create && owner) {
      flow = {
        reservations: 0,
        popups: new Set(),
        challengeObserved: false,
        challengeRevision: 0,
        challengeTab: null,
      };
      this.popupFlows.set(owner, flow);
    }
    return flow;
  }

  detachFlow(owner) {
    const flow = this.flowFor(owner);
    if (!flow) return;
    for (const popup of flow.popups) {
      this.popupOwners.delete(popup);
      this.popupNavigation.delete(popup);
    }
    flow.popups.clear();
    flow.reservations = 0;
    flow.challengeTab = null;
    this.popupFlows.delete(owner);
  }

  reservePopup(tab) {
    const owner = this.ownerTab(tab);
    if (!owner?.pendingCredential) return null;
    const flow = this.flowFor(owner, true);
    flow.reservations += 1;
    return { owner, active: true };
  }

  releasePopup(reservation) {
    if (!reservation?.active) return false;
    reservation.active = false;
    const flow = this.flowFor(reservation.owner);
    if (flow) flow.reservations = Math.max(0, flow.reservations - 1);
    return true;
  }

  linkPopup(reservation, popup) {
    if (!reservation?.active || !popup || !reservation.owner?.pendingCredential) {
      this.releasePopup(reservation);
      return false;
    }
    const owner = reservation.owner;
    const flow = this.flowFor(owner, true);
    this.releasePopup(reservation);
    this.popupOwners.set(popup, owner);
    this.popupNavigation.set(popup, {
      navigationCommitted: false,
      navigationSuccessful: false,
      destinationOrigin: '',
      revision: 0,
    });
    flow.popups.add(popup);
    return true;
  }

  closeTab(tab) {
    const owner = this.popupOwners.get(tab);
    if (!owner) {
      this.clear(tab);
      return;
    }
    const flow = this.flowFor(owner);
    flow?.popups.delete(tab);
    if (flow?.challengeTab === tab) flow.challengeTab = null;
    this.popupOwners.delete(tab);
    this.popupNavigation.delete(tab);
  }

  clear(tab) {
    if (!tab) return;
    const owner = this.ownerTab(tab);
    if (owner.pendingCredentialTimer) {
      this.clearTimer(owner.pendingCredentialTimer);
      owner.pendingCredentialTimer = null;
    }
    if (owner.pendingCredential) owner.pendingCredential.password = '';
    owner.pendingCredential = null;
    this.detachFlow(owner);
  }

  take(tab) {
    const owner = this.ownerTab(tab);
    if (!owner?.pendingCredential) return null;
    if (owner.pendingCredentialTimer) {
      this.clearTimer(owner.pendingCredentialTimer);
      owner.pendingCredentialTimer = null;
    }
    const candidate = owner.pendingCredential;
    owner.pendingCredential = null;
    this.detachFlow(owner);
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

    // A login submitted inside an existing popup starts a new independent
    // candidate; first retire the inherited flow without copying its secret.
    this.clear(tab);
    tab.pendingCredential = {
      origin,
      username,
      password,
      navigationCommitted: false,
      navigationSuccessful: false,
      destinationOrigin: '',
      challengeObserved: false,
    };
    this.flowFor(tab, true);
    tab.pendingCredentialTimer = this.setTimer(() => this.clear(tab), this.candidateTtlMs);
    tab.pendingCredentialTimer?.unref?.();
    return true;
  }

  markNavigation(tab, rawUrl, httpResponseCode = 0) {
    const owner = this.ownerTab(tab);
    const pending = owner?.pendingCredential;
    if (!pending) return false;
    try {
      const parsed = new URL(String(rawUrl || ''));
      const status = Number(httpResponseCode);
      const successful = status === 0 || (status >= 200 && status < 400);
      // A password submitted on HTTPS must never survive an insecure
      // destination or an HTTP rejection such as 401/403.
      if (parsed.protocol !== 'https:' || !successful) {
        this.clear(owner);
        return false;
      }
      const evidence = tab === owner ? pending : this.popupNavigation.get(tab);
      if (!evidence) return false;
      evidence.navigationCommitted = true;
      evidence.navigationSuccessful = true;
      evidence.destinationOrigin = parsed.origin;
      evidence.revision = ++this.navigationSequence;
      return true;
    } catch {
      this.clear(owner);
      return false;
    }
  }

  async confirmPageState(tab, pageState) {
    const owner = this.ownerTab(tab);
    const pending = owner?.pendingCredential;
    if (!pending || !pageState || typeof pageState !== 'object' ||
        typeof pageState.hasLoginForm !== 'boolean' ||
        typeof pageState.hasChallengeForm !== 'boolean') return false;
    let pageOrigin;
    try {
      pageOrigin = canonicalHttpsOrigin(pageState.origin);
    } catch {
      return false;
    }
    const currentOrigin = this.originForTab(tab);
    const flow = this.flowFor(owner, true);
    const isPopup = tab !== owner;
    const evidence = isPopup ? this.popupNavigation.get(tab) : pending;
    if (!evidence) return false;
    const sameDocument = pageState.transition === 'same-document';
    if (pageState.transition != null && !sameDocument) return false;
    // A stale document can report state after a newer navigation. Ignore it;
    // the bounded candidate timer will clean up if no matching page arrives.
    if (!pageOrigin || pageOrigin !== currentOrigin) return false;
    if (sameDocument) {
      // An SPA transition is valid either on the original password document,
      // or after a matching committed challenge document was explicitly
      // observed. A random post-navigation DOM change cannot confirm login.
      const originalPasswordDocument = !isPopup && !evidence.navigationCommitted &&
        !evidence.navigationSuccessful && pending.origin === pageOrigin;
      const committedChallengeDocument = evidence.navigationCommitted &&
        evidence.navigationSuccessful && evidence.destinationOrigin === pageOrigin &&
        flow.challengeObserved;
      if (!originalPasswordDocument && !committedChallengeDocument) return false;
    } else if (!evidence.navigationCommitted || !evidence.navigationSuccessful ||
        evidence.destinationOrigin !== pageOrigin) return false;
    if (pageState.hasLoginForm) {
      this.clear(owner);
      return false;
    }
    // A challenge is progress, not authentication completion. Keep the staged
    // password only for its existing bounded TTL so it can be offered after a
    // later explicit post-challenge page, but never prompt on the challenge.
    if (pageState.hasChallengeForm) {
      pending.challengeObserved = true;
      flow.challengeObserved = true;
      flow.challengeRevision = evidence.revision || this.navigationSequence;
      flow.challengeTab = tab;
      return false;
    }

    // Opening a popup is itself unresolved authentication progress. The
    // originating tab cannot conclude success while that popup (or its
    // deferred creation) is outstanding. A linked popup must first prove it
    // actually displayed a challenge, rather than being an unrelated ad/help
    // window. After a cross-tab challenge, the owner needs a fresh navigation;
    // an old blank/waiting document is not post-authentication evidence.
    if (!isPopup && (flow.reservations > 0 || flow.popups.size > 0)) return false;
    if (isPopup && !flow.challengeObserved) return false;
    if (flow.challengeObserved && flow.challengeTab !== tab && !sameDocument &&
        (evidence.revision || 0) <= flow.challengeRevision) return false;

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
