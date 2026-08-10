'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  credentialFromForm,
  isPasswordChangeForm,
  pageCredentialState,
} = require('../campus-preload');

function input(properties = {}) {
  return {
    autocomplete: '',
    disabled: false,
    id: '',
    name: '',
    placeholder: '',
    type: 'text',
    value: '',
    ...properties,
  };
}

function form(inputs, properties = {}) {
  return {
    ...properties,
    querySelectorAll(selector) {
      if (selector === 'input[type="password"]') {
        return inputs.filter((candidate) => candidate.type === 'password');
      }
      if (selector === 'input') return inputs;
      return [];
    },
  };
}

const HTTPS_LOCATION = {
  protocol: 'https:',
  origin: 'https://sso.example.edu',
};

test('login credential candidate is exact-origin HTTPS data', () => {
  const login = form([
    input({ name: 'account', autocomplete: 'username', value: 'student001' }),
    input({ name: 'password', type: 'password', autocomplete: 'current-password', value: 'secret' }),
  ]);
  assert.deepEqual(credentialFromForm(login, HTTPS_LOCATION), {
    origin: 'https://sso.example.edu',
    username: 'student001',
    password: 'secret',
  });
  assert.equal(credentialFromForm(login, { protocol: 'http:', origin: 'http://sso.example.edu' }), null);
});

test('password change and reset forms never become login candidates', () => {
  const change = form([
    input({ type: 'password', autocomplete: 'current-password', value: 'old-secret' }),
    input({ type: 'password', autocomplete: 'new-password', value: 'new-secret' }),
    input({ type: 'password', name: 'confirm_password', value: 'new-secret' }),
  ]);
  const reset = form([
    input({ type: 'password', name: 'new_password', value: 'new-secret' }),
  ]);
  const actionOnly = form([
    input({ type: 'password', name: 'password', value: 'new-secret' }),
  ], { action: 'https://sso.example.edu/account/change-password' });
  assert.equal(isPasswordChangeForm(change), true);
  assert.equal(isPasswordChangeForm(reset), true);
  assert.equal(isPasswordChangeForm(actionOnly), true);
  assert.equal(credentialFromForm(change, HTTPS_LOCATION), null);
  assert.equal(credentialFromForm(reset, HTTPS_LOCATION), null);
  assert.equal(credentialFromForm(actionOnly, HTTPS_LOCATION), null);
});

test('page state reports whether the post-navigation document still has a login form', () => {
  const login = form([input({ type: 'password', autocomplete: 'current-password' })]);
  assert.deepEqual(pageCredentialState({ forms: [login] }, HTTPS_LOCATION), {
    origin: HTTPS_LOCATION.origin,
    hasLoginForm: true,
  });
  const passwordReset = form([
    input({ type: 'password', autocomplete: 'new-password' }),
  ]);
  assert.deepEqual(pageCredentialState({ forms: [passwordReset] }, HTTPS_LOCATION), {
    origin: HTTPS_LOCATION.origin,
    hasLoginForm: true,
  });
  assert.deepEqual(pageCredentialState({ forms: [] }, HTTPS_LOCATION), {
    origin: HTTPS_LOCATION.origin,
    hasLoginForm: false,
  });
  assert.equal(pageCredentialState({ forms: [] }, { protocol: 'http:', origin: 'http://x' }), null);
});
