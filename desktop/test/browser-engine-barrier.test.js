'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { stopEngineAfterBrowserSuspend } = require('../lib/browser-engine-barrier');

test('a PAC/drain failure is reported but cannot strand the engine', async () => {
  const calls = [];
  const failure = new Error('closeAllConnections failed');
  const result = await stopEngineAfterBrowserSuspend({
    suspendBrowser: async () => {
      calls.push('suspend');
      throw failure;
    },
    browserBoundaryClosed: () => true,
    closeBrowser: () => calls.push('close-browser'),
    onSuspendError: (error) => calls.push(['warning', error]),
    stopEngine: async () => {
      calls.push('stop-engine');
      return { ok: true };
    },
  });

  assert.deepEqual(calls, [
    'suspend',
    ['warning', failure],
    'stop-engine',
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.browserSuspendError, failure);
});

test('an unconfirmed request gate closes the browser before stopping the engine', async () => {
  const calls = [];
  const result = await stopEngineAfterBrowserSuspend({
    suspendBrowser: async () => { throw new Error('request gate unavailable'); },
    browserBoundaryClosed: () => false,
    closeBrowser: () => calls.push('close-browser'),
    stopEngine: async () => {
      calls.push('stop-engine');
      return { ok: true };
    },
  });
  assert.deepEqual(calls, ['close-browser', 'stop-engine']);
  assert.equal(result.ok, true);
  assert.match(result.browserSuspendError.message, /gate/);
});

test('browser close failure never prevents owned-engine shutdown', async () => {
  let stopCalls = 0;
  const result = await stopEngineAfterBrowserSuspend({
    suspendBrowser: async () => { throw new Error('suspend failed'); },
    browserBoundaryClosed: () => false,
    closeBrowser: () => { throw new Error('close failed'); },
    stopEngine: async () => {
      stopCalls++;
      return { ok: false, phase: 'force-wait' };
    },
  });
  assert.equal(stopCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.phase, 'force-wait');
});
