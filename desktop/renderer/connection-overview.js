'use strict';

(function initializeConnectionOverview(globalScope) {
  const latencyHistory = [];
  const byId = (id) => document.getElementById(id);
  let translate = (key) => key;
  let copyText = null;

  function sparkline(values) {
    if (!values.length) return 'M2 24 L118 24';
    const safe = values.map((value) => Math.max(0, Math.min(1200, Number(value) || 0)));
    const min = Math.min(...safe), max = Math.max(...safe, min + 1);
    return safe.map((value, index) => {
      const x = 2 + (index * 116 / Math.max(1, safe.length - 1));
      const y = 27 - ((value - min) * 23 / (max - min));
      return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }

  function renderStatus(state = {}, t = translate) {
    const connected = state.connected === true;
    const busy = state.connecting === true;
    const overall = byId('topologyStatus');
    const tunnelNode = document.querySelector('[data-topology-node="tunnel"]');
    const browserNode = document.querySelector('[data-topology-node="browser"]');
    overall.className = `topology-overall ${connected ? 'healthy' : busy ? 'warning' : state.lastError ? 'error' : 'inactive'}`;
    overall.textContent = t(connected ? 'connect.pathReady' : busy ? 'connect.connecting' : state.lastError ? 'connect.needsAttention' : 'connect.disconnected');
    tunnelNode.dataset.status = connected ? 'healthy' : busy ? 'warning' : state.lastError ? 'error' : 'inactive';
    browserNode.dataset.status = connected ? 'healthy' : 'unknown';
    byId('tunnelSummary').textContent = t(connected ? 'connect.tunnelReady' : busy ? 'connect.tunnelConnecting' : 'connect.tunnelInactive');
    byId('notificationAttention').hidden = !state.lastError && !state.notice;
  }

  function renderTelemetry(telemetry = {}, t = translate) {
    if (Number.isFinite(telemetry.latencyMs)) {
      latencyHistory.push(telemetry.latencyMs);
      if (latencyHistory.length > 24) latencyHistory.shift();
    }
    const svg = byId('latencySparkline');
    if (svg) svg.innerHTML = `<path d="${sparkline(latencyHistory)}"/>`;
    const names = Array.isArray(telemetry.apps) ? telemetry.apps.map(({ name }) => name).filter(Boolean) : [];
    const local = byId('localNetworkSummary');
    const proxy = byId('proxyObservation');
    const proxyNames = names.filter((name) => /clash|mihomo/i.test(name));
    if (local) local.textContent = names.length ? t('connect.observedApps', { count: names.length }) : t('connect.proxyStateUnknown');
    if (proxy) {
      proxy.querySelector('span:last-child').textContent = proxyNames.length
        ? t('connect.proxyObserved', { names: proxyNames.join(', ') })
        : t('connect.proxyUnknown');
      proxy.querySelector('.branch-dot').className = `branch-dot ${proxyNames.length ? 'campus' : 'unknown'}`;
    }
  }

  function start(options = {}) {
    if (typeof options.translate === 'function') translate = options.translate;
    if (typeof options.copy === 'function') copyText = options.copy;
    byId('copyTunnelIp').addEventListener('click', async () => {
      const value = byId('stIp').textContent.trim();
      if (!value || value === '—' || !copyText) return;
      await copyText(value);
      const button = byId('copyTunnelIp');
      const previous = button.textContent;
      button.textContent = translate('connect.copied');
      window.setTimeout(() => { button.textContent = previous; }, 1200);
    });
  }

  const api = Object.freeze({ renderStatus, renderTelemetry, sparkline, start });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.connectionOverview = api;
})(typeof window !== 'undefined' ? window : null);
