'use strict';

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function createProfileSwitchBarrierEffects({
  activeContextLease,
  browserManager,
  cancelAuth,
  cancelOnboarding,
  cancelConnectivity,
  cancelMutations,
  stopEngine,
  revokeProxyAccess,
  clearServerState,
} = {}) {
  if (!activeContextLease || typeof activeContextLease.invalidate !== 'function' ||
      !browserManager || typeof browserManager.suspendRoutingPolicy !== 'function' ||
      typeof browserManager.closeForContextSwitch !== 'function') {
    throw new TypeError('Profile switch Main owners are invalid');
  }
  for (const [name, value] of Object.entries({
    cancelAuth,
    cancelOnboarding,
    cancelConnectivity,
    cancelMutations,
    stopEngine,
    revokeProxyAccess,
    clearServerState,
  })) requiredFunction(value, name);
  return Object.freeze({
    invalidateContext: () => activeContextLease.invalidate(),
    suspendBrowser: async () => {
      const result = browserManager.suspendRoutingPolicy();
      if (result && typeof result.then === 'function') await result;
      return true;
    },
    browserBoundaryClosed: () => browserManager.routingRequestsBlocked !== false,
    cancelAuth: () => { cancelAuth(); cancelOnboarding(); },
    cancelConnectivity,
    cancelMutations,
    closeBrowser: () => browserManager.closeForContextSwitch(),
    browserClosed: () => !browserManager.browser,
    stopEngine,
    revokeProxyAccess,
    clearServerState,
  });
}

module.exports = { createProfileSwitchBarrierEffects };
