'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  CREDENTIAL_CANDIDATE_TTL_MS,
  CredentialController,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
} = require('../lib/credential-controller');

function fixture(overrides = {}) {
  let currentOrigin = overrides.currentOrigin || 'https://sso.example.edu';
  const prompts = [];
  const saved = [];
  const errors = [];
  const timers = [];
  const clearedTimers = [];
  const vault = overrides.vault || {
    get: async () => null,
    save: async (...values) => saved.push(values),
  };
  const dialog = overrides.dialog || {
    showMessageBox: async (_window, options) => {
      prompts.push(options);
      return { response: 0 };
    },
  };
  const window = overrides.window || { isDestroyed: () => false };
  const controller = new CredentialController({
    vault,
    dialog,
    originForTab: () => currentOrigin,
    windowForPrompt: () => window,
    t: (key, vars) => vars?.host ? `${key}:${vars.host}` : key,
    onError: (message) => errors.push(message),
    setTimer: (callback, delay) => {
      const handle = { callback, delay, unref() { this.unrefCalled = true; } };
      timers.push(handle);
      return handle;
    },
    clearTimer: (handle) => clearedTimers.push(handle),
  });
  return {
    controller,
    clearedTimers,
    errors,
    prompts,
    saved,
    setCurrentOrigin(value) { currentOrigin = value; },
    timers,
  };
}

function candidate(overrides = {}) {
  return {
    origin: 'https://sso.example.edu',
    username: 'student001',
    password: 'local-secret',
    ...overrides,
  };
}

test('staging accepts only the exact current HTTPS origin and bounded values', () => {
  const { controller, timers } = fixture();
  const tab = {};
  for (const invalid of [
    candidate({ origin: 'http://sso.example.edu' }),
    candidate({ origin: 'https://sso.example.edu/' }),
    candidate({ origin: 'https://other.example.edu' }),
    candidate({ password: '' }),
    candidate({ username: 'u'.repeat(MAX_USERNAME_LENGTH + 1) }),
    candidate({ password: 'p'.repeat(MAX_PASSWORD_LENGTH + 1) }),
  ]) {
    assert.equal(controller.stage(tab, invalid), false);
  }

  assert.equal(controller.stage(tab, candidate()), true);
  assert.deepEqual(tab.pendingCredential, {
    origin: 'https://sso.example.edu',
    username: 'student001',
    password: 'local-secret',
    navigationCommitted: false,
    navigationSuccessful: false,
    destinationOrigin: '',
  });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, CREDENTIAL_CANDIDATE_TTL_MS);
  assert.equal(timers[0].unrefCalled, true);
});

test('a candidate is offered only after a successful matching page state', async () => {
  const state = fixture();
  const tab = {};
  state.controller.stage(tab, candidate());
  assert.equal(await state.controller.confirmPageState(tab, {
    origin: 'https://sso.example.edu', hasLoginForm: false,
  }), false, 'submission alone must never prompt');
  assert.equal(state.prompts.length, 0);

  // SSO may finish on a different HTTPS origin. The destination page state
  // must match the live tab, while the saved scope remains the form origin.
  assert.equal(state.controller.markNavigation(tab, 'https://portal.example.edu/home', 302), true);
  state.setCurrentOrigin('https://portal.example.edu');
  assert.equal(await state.controller.confirmPageState(tab, {
    origin: 'https://portal.example.edu', hasLoginForm: false,
  }), true);
  assert.equal(state.prompts.length, 1);
  assert.deepEqual(state.saved, [[
    'https://sso.example.edu', 'student001', 'local-secret',
  ]]);
  assert.equal(tab.pendingCredential, null);
});

test('401, 403, other rejected responses, and insecure navigation clear secrets immediately', () => {
  for (const [url, status] of [
    ['https://sso.example.edu/login', 401],
    ['https://sso.example.edu/login', 403],
    ['https://sso.example.edu/login', 500],
    ['http://sso.example.edu/login', 302],
  ]) {
    const { controller } = fixture();
    const tab = {};
    controller.stage(tab, candidate());
    const retained = tab.pendingCredential;
    assert.equal(controller.markNavigation(tab, url, status), false);
    assert.equal(retained.password, '', `${status} must erase the staged secret`);
    assert.equal(tab.pendingCredential, null);
  }
});

test('a completed page that still has a login form clears the candidate', async () => {
  const state = fixture();
  const tab = {};
  state.controller.stage(tab, candidate({ password: 'wrong-secret' }));
  const retained = tab.pendingCredential;
  state.controller.markNavigation(tab, 'https://sso.example.edu/login?error=1', 200);
  assert.equal(await state.controller.confirmPageState(tab, {
    origin: 'https://sso.example.edu', hasLoginForm: true,
  }), false);
  assert.equal(retained.password, '');
  assert.equal(tab.pendingCredential, null);
  assert.equal(state.prompts.length, 0);
});

test('timeout and every browser lifecycle cleanup use one zeroizing clear operation', () => {
  for (const reason of ['timeout', 'failed navigation', 'route change', 'tab close', 'renderer crash']) {
    const state = fixture();
    const tab = {};
    state.controller.stage(tab, candidate({ password: `${reason}-secret` }));
    const retained = tab.pendingCredential;
    if (reason === 'timeout') state.timers[0].callback();
    else state.controller.clear(tab);
    assert.equal(retained.password, '', `${reason} did not erase the candidate`);
    assert.equal(tab.pendingCredential, null);
  }
});

test('stale page state cannot confirm a candidate and remains bounded by its timer', async () => {
  const state = fixture();
  const tab = {};
  state.controller.stage(tab, candidate());
  state.controller.markNavigation(tab, 'https://portal.example.edu/home', 200);
  state.setCurrentOrigin('https://newer.example.edu');
  assert.equal(await state.controller.confirmPageState(tab, {
    origin: 'https://portal.example.edu', hasLoginForm: false,
  }), false);
  assert.ok(tab.pendingCredential, 'a stale prior document must not consume a newer flow');
  state.timers[0].callback();
  assert.equal(tab.pendingCredential, null);
});

test('save prompts are single-flight per origin and every candidate copy is erased', async () => {
  let resolvePrompt;
  const promptStarted = new Promise((resolve) => { resolvePrompt = resolve; });
  let releasePrompt;
  const promptFinished = new Promise((resolve) => { releasePrompt = resolve; });
  let promptCount = 0;
  const state = fixture({
    dialog: {
      showMessageBox: async () => {
        promptCount++;
        resolvePrompt();
        await promptFinished;
        return { response: 1 };
      },
    },
  });
  const first = candidate({ password: 'first-secret' });
  const second = candidate({ password: 'second-secret' });
  const firstOffer = state.controller.offer(first);
  await promptStarted;
  assert.equal(await state.controller.offer(second), false);
  assert.equal(second.password, '', 'the suppressed duplicate must be erased');
  releasePrompt();
  assert.equal(await firstOffer, true);
  assert.equal(first.password, '');
  assert.equal(promptCount, 1);
  assert.equal(state.controller.prompts.size, 0);
});

test('CampusBrowser delegates candidate state and keeps all lifecycle clear calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'campus-browser.js'), 'utf8');
  assert.match(source, /new CredentialController\(\{/);
  assert.match(source, /this\.credentialController\.stage\(tab, candidate\)/);
  assert.match(source, /this\.credentialController\.confirmPageState\(tab, candidate\)/);
  assert.match(source, /markCredentialNavigation\(tab, url, httpResponseCode\)/);
  for (const fragment of [
    'const handleLoadFailure',
    '\n  handleRendererCrash(tab, details = {})',
    '\n  async setTabRoute',
    '\n  closeTab(id)',
    "this.window.on('closed'",
  ]) {
    const start = source.indexOf(fragment);
    assert.notEqual(start, -1, `missing lifecycle boundary: ${fragment}`);
    assert.match(source.slice(start, start + 1800), /clearCredentialCandidate\(tab\)/,
      `${fragment} must clear any staged credential`);
  }
});
