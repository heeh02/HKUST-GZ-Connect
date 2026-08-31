'use strict';

const os = require('node:os');
const { createCommandRunner } = require('../platform/command-runner');
const { inventoryFromNode } = require('../platform/interface-inventory');
const { detectMacos } = require('../providers/macos-network-provider');
const { detectLinux } = require('../providers/linux-network-provider');
const { detectWindows } = require('../providers/windows-network-provider');
const { projectNetworkEnvironment } = require('../schema/network-environment-schema');

const PROVIDERS = Object.freeze({ darwin: detectMacos, linux: detectLinux, win32: detectWindows });

class NetworkEnvironmentService {
  constructor({ platform = process.platform, networkInterfaces = os.networkInterfaces,
    run = createCommandRunner(), environment = process.env, now = Date.now, ttlMs = 10_000 } = {}) {
    this.platform = platform; this.networkInterfaces = networkInterfaces; this.run = run;
    this.environment = environment; this.now = now; this.ttlMs = ttlMs;
    this.cachedAt = 0; this.cached = null; this.refreshInFlight = null;
  }

  fallbackSnapshot() {
    return { platform: this.platform, status: 'unknown',
      interfaces: inventoryFromNode(this.networkInterfaces(), this.platform),
      systemProxy: { state: 'unknown', type: 'unknown', endpoint: null, owner: {} } };
  }

  async rawSnapshot({ force = false } = {}) {
    const current = this.now();
    if (!force && this.cached && current - this.cachedAt < this.ttlMs) return this.cached;
    if (this.refreshInFlight) return this.refreshInFlight;
    const operation = (async () => {
      const fallback = this.fallbackSnapshot();
      const provider = PROVIDERS[this.platform];
      try {
        this.cached = provider
          ? await provider({ interfaces: fallback.interfaces, run: this.run, environment: this.environment })
          : fallback;
      } catch {
        this.cached = fallback;
      }
      this.cachedAt = this.now();
      return this.cached;
    })();
    this.refreshInFlight = operation;
    try { return await operation; }
    finally { if (this.refreshInFlight === operation) this.refreshInFlight = null; }
  }

  async snapshot(selection = '', options = {}) {
    return projectNetworkEnvironment(await this.rawSnapshot(options), selection);
  }
  cachedSnapshot(selection = '') {
    return projectNetworkEnvironment(this.cached || this.fallbackSnapshot(), selection);
  }
  resolveSelection(selection = '') {
    const snapshot = this.cachedSnapshot(selection);
    if (!snapshot.selection.available || !snapshot.selection.interfaceId) return null;
    const sourceAddress = snapshot.selection.sourceAddress || snapshot.defaultRoute?.sourceAddress || '';
    if (!sourceAddress) return null;
    return Object.freeze({ interfaceId: snapshot.selection.interfaceId,
      sourceAddress });
  }
  engineArguments(selection = '') {
    const resolved = this.resolveSelection(selection);
    if (!resolved) return selection ? null : Object.freeze([]);
    return Object.freeze(['--source-interface', resolved.interfaceId,
      '--source-address', resolved.sourceAddress]);
  }
  refresh(selection = '') { return this.snapshot(selection, { force: true }); }
}

module.exports = { NetworkEnvironmentService };
