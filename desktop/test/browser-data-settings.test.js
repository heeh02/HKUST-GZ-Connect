'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { start } = require('../renderer/browser-data-settings');

function fixture(result = { ok: true }) {
  const listeners = new Map();
  const documentListeners = new Map();
  const button = {
    disabled: false,
    textContent: '',
    addEventListener: (name, handler) => listeners.set(name, handler),
  };
  const status = { textContent: '' };
  let calls = 0;
  start({
    api: { clearBrowserData: async () => { calls += 1; return result; } },
    document: {
      getElementById: (id) => id === 'clearBrowserData' ? button : status,
      addEventListener: (name, handler) => documentListeners.set(name, handler),
    },
    translate: (key) => key,
  });
  return { button, status, listeners, documentListeners, get calls() { return calls; } };
}

test('browser data requires two clicks and reports a successful local clear', async () => {
  const f = fixture();
  await f.listeners.get('click')();
  assert.equal(f.calls, 0);
  assert.equal(f.button.textContent, 'settings.confirmClearBrowserData');
  assert.equal(f.status.textContent, 'settings.clearBrowserDataConfirmHint');
  await f.listeners.get('click')();
  assert.equal(f.calls, 1);
  assert.equal(f.button.textContent, 'settings.clearBrowserData');
  assert.equal(f.status.textContent, 'settings.browserDataCleared');
});

test('locale change disarms a pending destructive action', async () => {
  const f = fixture();
  await f.listeners.get('click')();
  f.documentListeners.get('app-locale-changed')();
  assert.equal(f.button.textContent, 'settings.clearBrowserData');
  assert.equal(f.status.textContent, '');
});
