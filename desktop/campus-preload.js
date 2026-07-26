'use strict';

const { ipcRenderer } = require('electron');

const MAX_USERNAME_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 4096;

function visibleInput(input) {
  return input && !input.disabled && input.type !== 'hidden';
}

function credentialFromForm(form) {
  const passwordInput = [...form.querySelectorAll('input[type="password"]')]
    .find(visibleInput);
  if (!passwordInput || !passwordInput.value ||
      passwordInput.value.length > MAX_PASSWORD_LENGTH) return null;

  const usernameInput = [...form.querySelectorAll('input')].find((input) => {
    if (!visibleInput(input) || input === passwordInput) return false;
    const type = String(input.type || 'text').toLowerCase();
    return input.autocomplete === 'username' || type === 'email' ||
      ['text', 'tel'].includes(type);
  });
  const username = String(usernameInput?.value || '');
  if (username.length > MAX_USERNAME_LENGTH || location.protocol !== 'https:') return null;
  return {
    origin: location.origin,
    username,
    password: passwordInput.value,
  };
}

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('submit', (event) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    const credential = credentialFromForm(event.target);
    if (credential) ipcRenderer.send('campus-credential-candidate', credential);
  }, true);
});

ipcRenderer.on('campus-credential-fill', (_event, credential) => {
  if (!credential || credential.origin !== location.origin ||
      location.protocol !== 'https:') return;
  const forms = [...document.forms];
  for (const form of forms) {
    const passwordInput = [...form.querySelectorAll('input[type="password"]')]
      .find(visibleInput);
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
