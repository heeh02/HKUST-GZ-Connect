'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ActiveContextLease } = require('../../../../lib/switching/active-context/active-context-lease');
const { ActiveContextSwitchBarrier } = require('../../../../lib/switching/effects/active-context-switch-barrier');

function lease() {
  return new ActiveContextLease({
    profileId: 'school-a',
    profileRevision: 1,
    accountHandle: `account-${'a'.repeat(36)}`,
    activeContextEpoch: 1,
  });
}

function fixture(overrides = {}) {
  const calls = [];
  let boundaryClosed = false;
  let browserPresent = true;
  const activeLease = lease();
  const barrier = new ActiveContextSwitchBarrier({
    invalidateContext: () => { calls.push('invalidate'); return activeLease.invalidate(); },
    suspendBrowser: async () => { calls.push('suspend'); boundaryClosed = true; },
    browserBoundaryClosed: () => boundaryClosed,
    cancelAuth: () => calls.push('cancel-auth'),
    cancelConnectivity: () => calls.push('cancel-connectivity'),
    cancelMutations: async () => { calls.push('drain-mutations'); return true; },
    closeBrowser: async () => { calls.push('close-browser'); browserPresent = false; },
    browserClosed: () => !browserPresent,
    stopEngine: async (generation) => {
      calls.push(['stop-engine', generation]);
      return { ok: true, cleanExit: true };
    },
    revokeProxyAccess: async () => { calls.push('revoke-proxy'); return true; },
    clearServerState: async () => { calls.push('clear-server'); return true; },
    ...overrides,
  });
  return { activeLease, barrier, calls };
}

test('Browser gate invalidates every context token before its first await', async () => {
  const value = fixture({
    suspendBrowser: async () => {
      value.calls.push('suspend');
      assert.equal(value.activeLease.snapshot(), null);
    },
    browserBoundaryClosed: () => true,
  });
  const token = value.activeLease.captureContext();
  assert.equal(await value.barrier.gateBrowser(), true);
  assert.equal(value.activeLease.isContextCurrent(token), false);
  assert.deepEqual(value.calls, ['invalidate', 'suspend']);
});

test('continuation cancellation drains mutations after auth and connectivity cancellation', async () => {
  const value = fixture();
  assert.equal(await value.barrier.cancelContinuations(), true);
  assert.deepEqual(value.calls, [
    'cancel-auth', 'cancel-connectivity', 'drain-mutations',
  ]);
  const blocked = fixture({ cancelMutations: async () => false });
  assert.equal(await blocked.barrier.cancelContinuations(), false);
});

test('Browser retirement Engine cleanup proxy revocation and server clearing require proof', async () => {
  const value = fixture();
  assert.equal(await value.barrier.closeBrowserWorkspace(), true);
  assert.equal(await value.barrier.confirmEngineStop({ engineGeneration: 7 }), true);
  assert.equal(await value.barrier.confirmEngineStop({ engineGeneration: null }), true);
  assert.equal(await value.barrier.revokeProxy(), true);
  assert.equal(await value.barrier.clearServer(), true);
  assert.deepEqual(value.calls, [
    'close-browser', ['stop-engine', 7], 'revoke-proxy', 'clear-server',
  ]);
});

test('unconfirmed Browser Engine or proxy cleanup remains fail closed', async () => {
  const browser = fixture({ browserClosed: () => false });
  assert.equal(await browser.barrier.closeBrowserWorkspace(), false);
  const engine = fixture({ stopEngine: async () => ({ ok: true, cleanExit: false }) });
  assert.equal(await engine.barrier.confirmEngineStop({ engineGeneration: 9 }), false);
  const proxy = fixture({ revokeProxyAccess: async () => false });
  assert.equal(await proxy.barrier.revokeProxy(), false);
});

test('hooks expose the exact coordinator lifecycle surface', () => {
  assert.deepEqual(Object.keys(fixture().barrier.hooks()).sort(), [
    'cancelContinuations', 'clearServerState', 'closeBrowserWorkspace', 'gateBrowser',
    'revokeProxyAccess', 'stopEngine',
  ]);
});
