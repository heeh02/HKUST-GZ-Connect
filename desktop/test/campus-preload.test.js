'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createSpaCredentialMonitor,
  credentialFromForm,
  isPasswordChangeForm,
  pageCredentialState,
  SPA_CREDENTIAL_SETTLE_MS,
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

test('SPA login waits for a stable same-origin password-form removal', () => {
  const login = form([
    input({ autocomplete: 'username', value: 'student001' }),
    input({ type: 'password', autocomplete: 'current-password', value: 'secret' }),
  ]);
  const pageDocument = { documentElement: {}, forms: [login] };
  const timers = [];
  const cleared = [];
  const states = [];
  let observerCallback = null;
  let disconnected = false;
  class FakeMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe(_target, options) { this.options = options; }
    disconnect() { disconnected = true; }
  }
  const monitor = createSpaCredentialMonitor({
    pageDocument,
    pageLocation: HTTPS_LOCATION,
    onState: (state) => states.push(state),
    MutationObserverClass: FakeMutationObserver,
    setTimer: (callback, delay) => {
      const handle = { callback, delay, unref() { this.unrefCalled = true; } };
      timers.push(handle);
      return handle;
    },
    clearTimer: (handle) => cleared.push(handle),
  });

  assert.equal(monitor.arm(HTTPS_LOCATION.origin), true);
  assert.equal(timers.length, 0, 'the submitted login form still blocks confirmation');
  pageDocument.forms = [];
  observerCallback();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, SPA_CREDENTIAL_SETTLE_MS);
  assert.equal(timers[0].unrefCalled, true);

  pageDocument.forms = [login];
  observerCallback();
  assert.deepEqual(cleared, [timers[0]], 'a returning password form cancels the candidate state');
  assert.deepEqual(states, []);

  pageDocument.forms = [];
  observerCallback();
  timers[1].callback();
  assert.deepEqual(states, [{
    origin: HTTPS_LOCATION.origin,
    hasLoginForm: false,
    transition: 'same-document',
  }]);
  observerCallback();
  assert.equal(states.length, 1, 'one submission can produce at most one SPA confirmation');
  monitor.stop();
  assert.equal(disconnected, true);
});

test('SPA monitoring is restricted to the exact current HTTPS origin', () => {
  const pageDocument = { documentElement: {}, forms: [] };
  class FakeMutationObserver { observe() {} disconnect() {} }
  const httpsMonitor = createSpaCredentialMonitor({
    pageDocument,
    pageLocation: HTTPS_LOCATION,
    MutationObserverClass: FakeMutationObserver,
  });
  assert.equal(httpsMonitor.arm('https://other.example.edu'), false);

  const httpMonitor = createSpaCredentialMonitor({
    pageDocument,
    pageLocation: { protocol: 'http:', origin: 'http://sso.example.edu' },
    MutationObserverClass: FakeMutationObserver,
  });
  assert.equal(httpMonitor.arm('http://sso.example.edu'), false);
});
