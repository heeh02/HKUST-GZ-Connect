'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createProfileSwitchBarrierEffects,
} = require('../lib/profile-switch-main-effects');

test('Main switch effects delegate exact owners and retain Browser proof', async () => {
  const calls = [];
  const browserManager = {
    browser: { open: true },
    routingRequestsBlocked: true,
    suspendRoutingPolicy: async () => calls.push('suspend'),
    closeForContextSwitch: async () => {
      calls.push('close');
      browserManager.browser = null;
      return true;
    },
  };
  const effects = createProfileSwitchBarrierEffects({
    activeContextLease: { invalidate: () => calls.push('invalidate') },
    browserManager,
    cancelAuth: () => calls.push('auth'),
    cancelOnboarding: () => calls.push('onboarding'),
    cancelConnectivity: () => calls.push('connectivity'),
    cancelMutations: async () => { calls.push('mutations'); return true; },
    stopEngine: async (generation) => { calls.push(['engine', generation]); return { ok: true }; },
    revokeProxyAccess: async () => { calls.push('proxy'); return true; },
    clearServerState: async () => { calls.push('server'); return true; },
  });
  effects.invalidateContext();
  await effects.suspendBrowser();
  assert.equal(effects.browserBoundaryClosed(), true);
  effects.cancelAuth();
  effects.cancelConnectivity();
  assert.equal(await effects.cancelMutations(), true);
  assert.equal(await effects.closeBrowser(), true);
  assert.equal(effects.browserClosed(), true);
  assert.deepEqual(await effects.stopEngine(7), { ok: true });
  assert.equal(await effects.revokeProxyAccess(), true);
  assert.equal(await effects.clearServerState(), true);
  assert.deepEqual(calls, [
    'invalidate', 'suspend', 'auth', 'onboarding', 'connectivity', 'mutations',
    'close', ['engine', 7], 'proxy', 'server',
  ]);
});

test('Browser boundary remains fail closed until Session and window confirm cleanup', async () => {
  const browserManager = {
    browser: {},
    routingRequestsBlocked: false,
    suspendRoutingPolicy: () => null,
    closeForContextSwitch: async () => false,
  };
  const effects = createProfileSwitchBarrierEffects({
    activeContextLease: { invalidate() {} }, browserManager,
    cancelAuth() {}, cancelOnboarding() {}, cancelConnectivity() {},
    cancelMutations: async () => true, stopEngine: async () => ({ ok: true }),
    revokeProxyAccess: async () => true, clearServerState: async () => true,
  });
  await effects.suspendBrowser();
  assert.equal(effects.browserBoundaryClosed(), false);
  assert.equal(await effects.closeBrowser(), false);
  assert.equal(effects.browserClosed(), false);
});
