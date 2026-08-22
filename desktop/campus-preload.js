'use strict';

const { ipcRenderer } = require('electron');

const MAX_USERNAME_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 4096;
const SPA_CREDENTIAL_SETTLE_MS = 2000;
const PASSWORD_CHANGE_HINT = /(?:^|[^a-z])(?:new|confirm|repeat|retype|change|reset)(?:$|[^a-z])|(?:new|confirm|repeat|retype|change|reset)password|password(?:new|confirm|repeat|retype|change|reset)|新密码|确认密码|重复密码/i;
const CHALLENGE_FIELD_HINT = /(?:^|[^a-z0-9])(?:otp|totp|mfa|2fa|passcode|verification|verify|one\s*time\s*code|security\s*code|auth(?:entication)?\s*code)(?:$|[^a-z0-9])|验证码|校验码|动态码|认证码|一次性(?:密码|口令|验证码)/i;
const GENERIC_CODE_FIELD_HINT = /(?:^|[^a-z0-9])code(?:$|[^a-z0-9])/i;
const USERNAME_FIELD_HINT = /(?:^|[^a-z0-9])(?:user|username|account|student|login|email)(?:$|[^a-z0-9])|账号|用户名|学号|邮箱/i;
const CHALLENGE_CONTEXT_HINT = /(?:otp|totp|mfa|2fa|multi[- ]?factor|two[- ]?factor|second[- ]?factor|one[- ]?time(?:\s+(?:password|passcode|code))?|verification\s+(?:code|step)|security\s+code|auth(?:entication)?\s+code|approve\s+(?:the\s+)?(?:sign[- ]?in|login)|check\s+(?:your\s+)?device|push\s+notification)|验证码|校验码|动态码|二次认证|双重认证|多因素认证|批准登录|确认登录|检查.{0,12}设备/i;
const MAX_CLASSIFIER_HINT_LENGTH = 4096;

function visibleInput(input) {
  return input && !input.disabled && input.type !== 'hidden';
}

function visiblePasswordInputs(form) {
  return [...form.querySelectorAll('input[type="password"]')].filter(visibleInput);
}

function normalizedHint(values) {
  return values
    .map((value) => String(value || '').slice(0, MAX_CLASSIFIER_HINT_LENGTH)
      .replace(/([a-z])([A-Z])/g, '$1 $2').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_CLASSIFIER_HINT_LENGTH);
}

function attributeValue(element, name, property = name) {
  return element?.getAttribute?.(name) ?? element?.[property] ?? '';
}

function challengeInputHint(input) {
  return normalizedHint([
    input?.name,
    input?.id,
    input?.autocomplete,
    input?.placeholder,
    attributeValue(input, 'aria-label', 'ariaLabel'),
    attributeValue(input, 'inputmode', 'inputMode'),
  ]);
}

function isChallengeInput(input) {
  if (!visibleInput(input)) return false;
  const autocomplete = String(input.autocomplete || '').toLowerCase().split(/\s+/);
  const hint = challengeInputHint(input);
  if (autocomplete.includes('one-time-code') || CHALLENGE_FIELD_HINT.test(hint)) return true;
  const type = String(input.type || 'text').toLowerCase();
  return !autocomplete.includes('username') && type !== 'email' &&
    !USERNAME_FIELD_HINT.test(hint) && GENERIC_CODE_FIELD_HINT.test(hint);
}

function loginUsernameInput(form, passwordInput) {
  return [...form.querySelectorAll('input')].find((input) => {
    if (!visibleInput(input) || input === passwordInput || isChallengeInput(input)) return false;
    const type = String(input.type || 'text').toLowerCase();
    return input.autocomplete === 'username' || type === 'email' || ['text', 'tel'].includes(type);
  }) || null;
}

function pageChallengeHint(pageDocument) {
  return normalizedHint([
    pageDocument?.title,
    pageDocument?.body?.innerText,
    pageDocument?.body?.textContent,
  ]);
}

function isAuthenticationChallengeForm(form, pageDocument = globalThis.document) {
  if (!form) return false;
  const inputs = [...form.querySelectorAll('input')].filter(visibleInput);
  if (inputs.some(isChallengeInput)) return true;
  const formHint = normalizedHint([
    form.action,
    form.id,
    form.name,
    form.className,
    attributeValue(form, 'aria-label', 'ariaLabel'),
    form.textContent,
  ]);
  if (CHALLENGE_CONTEXT_HINT.test(formHint)) return true;

  // Some IdPs render an OTP as a plain password field. Page-level challenge
  // evidence is used only when the form has one password and no username-like
  // field, so a normal account/password page keeps its existing autofill path.
  const passwords = visiblePasswordInputs(form);
  return passwords.length === 1 && !loginUsernameInput(form, passwords[0]) &&
    CHALLENGE_CONTEXT_HINT.test(pageChallengeHint(pageDocument));
}

function pageHasAuthenticationChallenge(pageDocument = globalThis.document) {
  if (!pageDocument) return false;
  const forms = [...(pageDocument.forms || [])];
  if (forms.some((form) => isAuthenticationChallengeForm(form, pageDocument))) return true;
  const pageInputs = [...(pageDocument.querySelectorAll?.('input') || [])];
  return pageInputs.some(isChallengeInput) || CHALLENGE_CONTEXT_HINT.test(pageChallengeHint(pageDocument));
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

function loginPasswordInput(form, {
  requireValue = true,
  pageDocument = globalThis.document,
} = {}) {
  if (!form || isPasswordChangeForm(form) ||
      isAuthenticationChallengeForm(form, pageDocument)) return null;
  const passwordInput = visiblePasswordInputs(form)[0] || null;
  if (!passwordInput) return null;
  if (requireValue && (!passwordInput.value ||
      String(passwordInput.value).length > MAX_PASSWORD_LENGTH)) return null;
  return passwordInput;
}

function credentialFromForm(form, pageLocation = globalThis.location,
  pageDocument = globalThis.document) {
  const passwordInput = loginPasswordInput(form, { pageDocument });
  if (!passwordInput || !passwordInput.value ||
      passwordInput.value.length > MAX_PASSWORD_LENGTH) return null;

  const usernameInput = loginUsernameInput(form, passwordInput);
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
  const forms = [...(pageDocument.forms || [])];
  return {
    origin: pageLocation.origin,
    // Any password form (including reset/change) means the authentication flow
    // is not yet at a stable post-login page, so confirmation must stay blocked.
    hasLoginForm: forms.some((form) =>
      !isAuthenticationChallengeForm(form, pageDocument) && visiblePasswordInputs(form).length > 0),
    // Challenge detection never reads field values. Its only purpose is to
    // block password autofill/capture and post-login confirmation until the
    // second-factor surface has disappeared.
    hasChallengeForm: pageHasAuthenticationChallenge(pageDocument),
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
    if (!state || state.hasLoginForm || state.hasChallengeForm) {
      cancelTimer();
      return false;
    }
    if (timer) return true;
    timer = setTimer(() => {
      timer = null;
      const settled = matchingState();
      if (!settled || settled.hasLoginForm || settled.hasChallengeForm || emitted) return;
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
      attributeFilter: [
        'action', 'aria-label', 'autocomplete', 'class', 'disabled', 'id',
        'inputmode', 'name', 'placeholder', 'type',
      ],
      childList: true,
      characterData: true,
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
      const credential = credentialFromForm(event.target, globalThis.location, document);
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
    if (state) {
      // A challenge can itself be an SPA. Arm a value-free observer on that
      // exact origin so its later disappearance is reported; the main process
      // independently decides whether a bounded password candidate exists.
      if (state.hasChallengeForm) spaCredentialMonitor.arm(state.origin);
      ipcRenderer.send('campus-credential-page-state', state);
    }
    window.addEventListener('pagehide', () => spaCredentialMonitor.stop(), { once: true });
  });

  ipcRenderer.on('campus-credential-fill', (_event, credential) => {
    if (!credential || credential.origin !== location.origin ||
        location.protocol !== 'https:') return;
    const forms = [...document.forms];
    for (const form of forms) {
      const passwordInput = loginPasswordInput(form, {
        requireValue: false,
        pageDocument: document,
      });
      if (!passwordInput) continue;
      const usernameInput = loginUsernameInput(form, passwordInput);
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
    isAuthenticationChallengeForm,
    isChallengeInput,
    isPasswordChangeForm,
    loginPasswordInput,
    pageHasAuthenticationChallenge,
    pageCredentialState,
    SPA_CREDENTIAL_SETTLE_MS,
    visibleInput,
  };
}
