'use strict';

const net = require('node:net');
const { AppConnectionEnumerator } = require('./app-connection-enumerator');
const { runConcurrentHealthRound } = require('./health-supervisor');
const { probeSocksConnect } = require('./socks-health');
const { TelemetryService } = require('./telemetry-service');
const { PROBE_TIMEOUT_MS, shouldRecover } = require('./tunnel-health');

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

class ConnectionTelemetryCoordinator {
  constructor({
    appPid,
    gatewayHost,
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
        !enumerator || typeof enumerator.list !== 'function') {
      throw new TypeError('connection telemetry environment is incomplete');
    }
    Object.assign(this, {
      appPid, gatewayHost, getSocksPort, getEnginePid, getProxyCredentials,
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
      collectLatency: () => this.ping(this.gatewayHost, 443),
      collectHealth: (generation) => this.checkHealth(generation),
      emit: (snapshot, generation) => {
        if (this.current(generation)) {
          this.send({ connectedAt: this.getConnectedAt(), ...snapshot });
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

module.exports = { ConnectionTelemetryCoordinator, tcpPing };
