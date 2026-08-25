'use strict';

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

class ActiveContextSwitchBarrier {
  constructor({
    invalidateContext,
    suspendBrowser,
    browserBoundaryClosed,
    cancelAuth,
    cancelConnectivity,
    cancelMutations,
    closeBrowser,
    browserClosed,
    stopEngine,
    revokeProxyAccess,
    clearServerState,
  } = {}) {
    for (const [name, value] of Object.entries({
      invalidateContext,
      suspendBrowser,
      browserBoundaryClosed,
      cancelAuth,
      cancelConnectivity,
      cancelMutations,
      closeBrowser,
      browserClosed,
      stopEngine,
      revokeProxyAccess,
      clearServerState,
    })) requiredFunction(value, name);
    Object.assign(this, {
      invalidateContext,
      suspendBrowser,
      browserBoundaryClosed,
      cancelAuth,
      cancelConnectivity,
      cancelMutations,
      closeBrowser,
      browserClosed,
      stopEngine,
      revokeProxyAccess,
      clearServerState,
    });
  }

  async gateBrowser() {
    // Token invalidation is synchronous and precedes every await. Even if PAC
    // suspension fails, old Engine/health/MFA/mutation callbacks are stale.
    this.invalidateContext();
    try { await this.suspendBrowser(); }
    catch { return false; }
    return this.browserBoundaryClosed() === true;
  }

  async cancelContinuations() {
    try {
      this.cancelAuth();
      this.cancelConnectivity();
      return await this.cancelMutations() === true;
    } catch {
      return false;
    }
  }

  async closeBrowserWorkspace() {
    try { await this.closeBrowser(); }
    catch { return false; }
    return this.browserClosed() === true;
  }

  async confirmEngineStop(journal) {
    if (journal?.engineGeneration === null) return true;
    let result;
    try { result = await this.stopEngine(journal?.engineGeneration); }
    catch { return false; }
    return result?.ok === true && result.cleanExit !== false;
  }

  async revokeProxy() {
    try { return await this.revokeProxyAccess() === true; }
    catch { return false; }
  }

  async clearServer() {
    try { return await this.clearServerState() === true; }
    catch { return false; }
  }

  hooks() {
    return Object.freeze({
      gateBrowser: () => this.gateBrowser(),
      cancelContinuations: () => this.cancelContinuations(),
      closeBrowserWorkspace: () => this.closeBrowserWorkspace(),
      stopEngine: (journal) => this.confirmEngineStop(journal),
      revokeProxyAccess: () => this.revokeProxy(),
      clearServerState: () => this.clearServer(),
    });
  }
}

module.exports = { ActiveContextSwitchBarrier };
