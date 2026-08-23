'use strict';

const net = require('node:net');
const { AppConnectionEnumerator } = require('./app-connection-enumerator');
const { runConcurrentHealthRound } = require('./health-supervisor');
const { probeSocksConnect } = require('./socks-health');
const { TelemetryService } = require('./telemetry-service');
const { PROBE_TIMEOUT_MS, shouldRecover } = require('./tunnel-health');
const RENDERER_HEALTH_STATES = new Set([
  'unknown', 'healthy', 'site-failure', 'tunnel-failure', 'settings-unavailable', 'stale',
]);

function tcpPing(host, port) {
  return new Promise((resolve) => {
    if (!host) return resolve(null);
    const started = process.hrtime.bigint();
    const socket = net.connect({ host, port });
    const done = (ok) => {
      try { socket.destroy(); } catch {}
      resolve(ok ? Number(process.hrtime.bigint() - started) / 1e6 : null);
    };
    socket.setTimeout(3000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function validHealthTargets(value) {
  return Array.isArray(value) && value.length >= 2 && value.every((target) => (
    target && typeof target.host === 'string' && target.host &&
    Number.isInteger(target.port) && target.port >= 1 && target.port <= 65535
  ));
}

function rendererTelemetrySnapshot(snapshot, connectedAt) {
  const failedHealthTargetCount = Number(snapshot?.failedHealthTargetCount);
  return {
    connectedAt,
    connCount: Math.max(0, Number(snapshot?.connCount) || 0),
    apps: Array.isArray(snapshot?.apps) ? snapshot.apps : [],
    latencyMs: Number.isFinite(snapshot?.latencyMs) ? snapshot.latencyMs : null,
    tunnelHealth: RENDERER_HEALTH_STATES.has(snapshot?.tunnelHealth)
      ? snapshot.tunnelHealth
      : 'unknown',
    failedHealthTargetCount: Number.isInteger(failedHealthTargetCount)
      ? Math.max(0, Math.min(8, failedHealthTargetCount))
      : 0,
  };
}

class ConnectionTelemetryCoordinator {
  constructor({
    appPid,
    gatewayHost,
    gatewayPort = 443,
    healthTargets = null,
    getSocksPort,
    getEnginePid,
    getProxyCredentials,
    isConnected,
    isEngineCurrent,
    isVisible,
    getConnectedAt,
    send,
    getAutoReconnect,
    isDesiredConnected,
    reconnect,
    onRecovering,
    enumerator = new AppConnectionEnumerator(),
    runHealthRound = runConcurrentHealthRound,
    probe = probeSocksConnect,
    ping = tcpPing,
    TelemetryServiceClass = TelemetryService,
  } = {}) {
    for (const dependency of [
      getSocksPort, getEnginePid, getProxyCredentials, isConnected,
      isEngineCurrent, isVisible, getConnectedAt, send, getAutoReconnect,
      isDesiredConnected, reconnect, onRecovering, runHealthRound, probe, ping,
      TelemetryServiceClass,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('connection telemetry dependencies are incomplete');
      }
    }
    if (!Number.isInteger(appPid) || appPid <= 0 || typeof gatewayHost !== 'string' ||
        !Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535 ||
        (healthTargets !== null && !validHealthTargets(healthTargets)) ||
        !enumerator || typeof enumerator.list !== 'function') {
      throw new TypeError('connection telemetry environment is incomplete');
    }
    Object.assign(this, {
      appPid, gatewayHost, gatewayPort,
      healthTargets: healthTargets === null
        ? null
        : Object.freeze(healthTargets.map((target) => Object.freeze({ ...target }))),
      getSocksPort, getEnginePid, getProxyCredentials,
      isConnected, isEngineCurrent, isVisible, getConnectedAt, send,
      getAutoReconnect, isDesiredConnected, reconnect, onRecovering,
      enumerator, runHealthRound, probe, ping,
    });
    this.generation = null;
    this.probeFailures = 0;
    this.recoveryInFlight = null;
    this.service = new TelemetryServiceClass({
      collectApps: () => this.enumerator.list({
        ports: [this.getSocksPort()],
        enginePid: this.getEnginePid(),
        appPid: this.appPid,
      }),
      collectLatency: () => this.ping(this.gatewayHost, this.gatewayPort),
      collectHealth: (generation) => this.checkHealth(generation),
      emit: (snapshot, generation) => {
        if (this.current(generation)) {
          this.send(rendererTelemetrySnapshot(snapshot, this.getConnectedAt()));
        }
      },
      isVisible: this.isVisible,
      isGenerationCurrent: (generation) => this.current(generation),
    });
  }

  current(generation) {
    return this.generation === generation && this.isConnected() &&
      this.isEngineCurrent(generation);
  }

  start(generation) {
    this.stop();
    this.generation = generation;
    this.service.start(generation);
  }

  stop() {
    this.generation = null;
    this.service.stop();
    this.probeFailures = 0;
    this.recoveryInFlight = null;
  }

  async checkHealth(generation) {
    if (!this.current(generation) ||
        this.recoveryInFlight?.generation === generation) return undefined;
    let proxyPort;
    try { proxyPort = Number(this.getSocksPort()); }
    catch { return { kind: 'settings-unavailable', failedTargets: [] }; }
    const result = await this.runHealthRound({
      generation,
      isGenerationCurrent: (candidate) => this.current(candidate),
      probe: this.probe,
      proxyPort,
      proxyCredentials: this.getProxyCredentials(generation),
      ...(this.healthTargets === null ? {} : { targets: this.healthTargets }),
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (result.kind === 'stale') return result;
    if (result.kind === 'healthy' || result.kind === 'site-failure') {
      this.probeFailures = 0;
      return result;
    }
    this.probeFailures += 1;
    let autoReconnect;
    try { autoReconnect = this.getAutoReconnect(); }
    catch { return { ...result, kind: 'settings-unavailable' }; }
    if (!shouldRecover({ failures: this.probeFailures, autoReconnect })) return result;
    if (!this.current(generation) || !this.isDesiredConnected()) {
      return { ...result, kind: 'stale' };
    }
    const recovery = { generation };
    this.recoveryInFlight = recovery;
    this.onRecovering();
    try {
      await this.reconnect(generation);
    } finally {
      if (this.recoveryInFlight === recovery) {
        this.probeFailures = 0;
        this.recoveryInFlight = null;
      }
    }
    return result;
  }
}

module.exports = { ConnectionTelemetryCoordinator, rendererTelemetrySnapshot, tcpPing };
