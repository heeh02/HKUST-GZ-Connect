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
    this.cachedAt = 0; this.cached = null;
  }

  rawSnapshot() {
    const current = this.now();
    if (this.cached && current - this.cachedAt < this.ttlMs) return this.cached;
    const interfaces = inventoryFromNode(this.networkInterfaces(), this.platform);
    const provider = PROVIDERS[this.platform];
    this.cached = provider ? provider({ interfaces, run: this.run, environment: this.environment })
      : { platform: this.platform, status: 'unknown', interfaces,
        systemProxy: { state: 'unknown', type: 'unknown', endpoint: null, owner: {} } };
    this.cachedAt = current;
    return this.cached;
  }

  snapshot(selection = '') { return projectNetworkEnvironment(this.rawSnapshot(), selection); }
  resolveSelection(selection = '') {
    const snapshot = this.snapshot(selection);
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
  refresh(selection = '') { this.cached = null; return this.snapshot(selection); }
}

module.exports = { NetworkEnvironmentService };
