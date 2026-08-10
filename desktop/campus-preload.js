'use strict';

const { ipcRenderer } = require('electron');

const MAX_USERNAME_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 4096;
const SPA_CREDENTIAL_SETTLE_MS = 2000;
const PASSWORD_CHANGE_HINT = /(?:^|[^a-z])(?:new|confirm|repeat|retype|change|reset)(?:$|[^a-z])|(?:new|confirm|repeat|retype|change|reset)password|password(?:new|confirm|repeat|retype|change|reset)|新密码|确认密码|重复密码/i;

function visibleInput(input) {
  return input && !input.disabled && input.type !== 'hidden';
}

function visiblePasswordInputs(form) {
  return [...form.querySelectorAll('input[type="password"]')].filter(visibleInput);
}

function passwordInputHint(input) {
  return [input?.name, input?.id, input?.autocomplete, input?.placeholder]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

// Password-change/reset forms often contain current/new/confirmation fields.
// Never offer those values to the login vault: saving either the old password
// or an unconfirmed new value is both confusing and potentially destructive.
function isPasswordChangeForm(form) {
  const passwordInputs = visiblePasswordInputs(form);
  if (passwordInputs.length !== 1) return passwordInputs.length > 0;
  const input = passwordInputs[0];
  const formHint = [form?.action, form?.id, form?.name, form?.className,
    form?.getAttribute?.('aria-label')]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  return String(input.autocomplete || '').toLowerCase() === 'new-password' ||
    PASSWORD_CHANGE_HINT.test(passwordInputHint(input)) ||
    PASSWORD_CHANGE_HINT.test(formHint);
}

function loginPasswordInput(form, { requireValue = true } = {}) {
  if (!form || isPasswordChangeForm(form)) return null;
  const passwordInput = visiblePasswordInputs(form)[0] || null;
  if (!passwordInput) return null;
  if (requireValue && (!passwordInput.value ||
      String(passwordInput.value).length > MAX_PASSWORD_LENGTH)) return null;
  return passwordInput;
}

function credentialFromForm(form, pageLocation = globalThis.location) {
  const passwordInput = loginPasswordInput(form);
  if (!passwordInput || !passwordInput.value ||
      passwordInput.value.length > MAX_PASSWORD_LENGTH) return null;

  const usernameInput = [...form.querySelectorAll('input')].find((input) => {
    if (!visibleInput(input) || input === passwordInput) return false;
    const type = String(input.type || 'text').toLowerCase();
    return input.autocomplete === 'username' || type === 'email' ||
      ['text', 'tel'].includes(type);
  });
  const username = String(usernameInput?.value || '');
  if (username.length > MAX_USERNAME_LENGTH || pageLocation?.protocol !== 'https:') return null;
  return {
    origin: pageLocation.origin,
    username,
    password: passwordInput.value,
  };
}

function pageCredentialState(pageDocument = globalThis.document,
  pageLocation = globalThis.location) {
  if (!pageDocument || pageLocation?.protocol !== 'https:') return null;
  return {
    origin: pageLocation.origin,
    // Any password form (including reset/change) means the authentication flow
    // is not yet at a stable post-login page, so confirmation must stay blocked.
    hasLoginForm: [...pageDocument.forms].some((form) =>
      visiblePasswordInputs(form).length > 0),
  };
}

// Traditional logins commit a new main-frame document, which is confirmed by
// did-navigate in the main process. Some SSO pages instead replace the login
// form inside one SPA document. Observe only after a valid login submission,
// retain only its exact origin (never the password), and require the password
// form to stay absent before reporting that same-document transition.
function createSpaCredentialMonitor({
  pageDocument = globalThis.document,
  pageLocation = globalThis.location,
  onState,
  MutationObserverClass = globalThis.MutationObserver,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  settleMs = SPA_CREDENTIAL_SETTLE_MS,
} = {}) {
  let armedOrigin = '';
  let emitted = false;
  let timer = null;
  let observer = null;

  const cancelTimer = () => {
    if (!timer) return;
    clearTimer(timer);
    timer = null;
  };
  const matchingState = () => {
    const state = pageCredentialState(pageDocument, pageLocation);
    return state && state.origin === armedOrigin ? state : null;
  };
  const evaluate = () => {
    if (!armedOrigin || emitted) return false;
    const state = matchingState();
    if (!state || state.hasLoginForm) {
      cancelTimer();
      return false;
    }
    if (timer) return true;
    timer = setTimer(() => {
      timer = null;
      const settled = matchingState();
      if (!settled || settled.hasLoginForm || emitted) return;
      emitted = true;
      armedOrigin = '';
      if (typeof onState === 'function') {
        onState({ ...settled, transition: 'same-document' });
      }
    }, Math.max(0, Number(settleMs) || SPA_CREDENTIAL_SETTLE_MS));
    timer?.unref?.();
    return true;
  };
  const ensureObserver = () => {
    if (observer || typeof MutationObserverClass !== 'function') return !!observer;
    const target = pageDocument?.documentElement || pageDocument;
    if (!target) return false;
    observer = new MutationObserverClass(evaluate);
    observer.observe(target, {
      attributes: true,
      attributeFilter: ['disabled', 'type'],
      childList: true,
      subtree: true,
    });
    return true;
  };

  return {
    arm(origin) {
      cancelTimer();
      emitted = false;
      armedOrigin = '';
      if (typeof origin !== 'string' || pageLocation?.protocol !== 'https:' ||
          origin !== pageLocation.origin || !ensureObserver()) return false;
      armedOrigin = origin;
      evaluate();
      return true;
    },
    evaluate,
    stop() {
      cancelTimer();
      armedOrigin = '';
      emitted = false;
      observer?.disconnect?.();
      observer = null;
    },
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && ipcRenderer) {
  window.addEventListener('DOMContentLoaded', () => {
    const spaCredentialMonitor = createSpaCredentialMonitor({
      onState: (state) => ipcRenderer.send('campus-credential-page-state', state),
    });
    document.addEventListener('submit', (event) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      const credential = credentialFromForm(event.target);
      if (credential) {
        ipcRenderer.send('campus-credential-candidate', credential);
        spaCredentialMonitor.arm(credential.origin);
      }
    }, true);

    // A candidate is deliberately not treated as a successful login at submit
    // time. After a later main-frame navigation, the main process uses this
    // state to reject failed logins (the login form is still present) or offer
    // the candidate once the destination page no longer contains that form.
    const state = pageCredentialState();
    if (state) ipcRenderer.send('campus-credential-page-state', state);
    window.addEventListener('pagehide', () => spaCredentialMonitor.stop(), { once: true });
  });

  ipcRenderer.on('campus-credential-fill', (_event, credential) => {
    if (!credential || credential.origin !== location.origin ||
        location.protocol !== 'https:') return;
    const forms = [...document.forms];
    for (const form of forms) {
      const passwordInput = loginPasswordInput(form, { requireValue: false });
      if (!passwordInput) continue;
      const usernameInput = [...form.querySelectorAll('input')].find((input) => {
        if (!visibleInput(input) || input === passwordInput) return false;
        const type = String(input.type || 'text').toLowerCase();
        return input.autocomplete === 'username' || type === 'email' ||
          ['text', 'tel'].includes(type);
      });
      if (usernameInput) {
        usernameInput.value = String(credential.username || '');
        usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
        usernameInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      passwordInput.value = String(credential.password || '');
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
      passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
      break;
    }
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    createSpaCredentialMonitor,
    credentialFromForm,
    isPasswordChangeForm,
    loginPasswordInput,
    pageCredentialState,
    SPA_CREDENTIAL_SETTLE_MS,
    visibleInput,
  };
}
