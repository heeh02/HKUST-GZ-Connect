'use strict';

const { ipcRenderer } = require('electron');

const MAX_USERNAME_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 4096;
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

if (typeof window !== 'undefined' && typeof document !== 'undefined' && ipcRenderer) {
  window.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('submit', (event) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      const credential = credentialFromForm(event.target);
      if (credential) ipcRenderer.send('campus-credential-candidate', credential);
    }, true);

    // A candidate is deliberately not treated as a successful login at submit
    // time. After a later main-frame navigation, the main process uses this
    // state to reject failed logins (the login form is still present) or offer
    // the candidate once the destination page no longer contains that form.
    const state = pageCredentialState();
    if (state) ipcRenderer.send('campus-credential-page-state', state);
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
    credentialFromForm,
    isPasswordChangeForm,
    loginPasswordInput,
    pageCredentialState,
    visibleInput,
  };
}
