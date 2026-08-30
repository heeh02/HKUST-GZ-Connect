'use strict';

(function initializeConnectionOverview(globalScope) {
  const latencyHistory = [];
  const byId = (id) => document.getElementById(id);
  let translate = (key) => key;
  let copyText = null;
  let saveSettings = null;
  let refreshState = null;
  let savingUnderlay = false;

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
    if (state.networkEnvironment) renderEnvironment(state.networkEnvironment, t);
  }

  function renderEnvironment(environment, t = translate) {
    const interfaces = Array.isArray(environment?.interfaces) ? environment.interfaces : [];
    const defaultAdapter = interfaces.find(({ default: activeDefault }) => activeDefault) || null;
    byId('defaultAdapterName').textContent = defaultAdapter
      ? `${defaultAdapter.name} · ${defaultAdapter.id}` : t('connect.notDetected');
    byId('defaultAdapterAddress').textContent = environment?.defaultRoute?.sourceAddress || '—';
    const systemAdapter = interfaces.find(({ systemDefault }) => systemDefault) || defaultAdapter;
    byId('systemRouteName').textContent = systemAdapter
      ? `${systemAdapter.name} · ${systemAdapter.id}` : t('connect.notDetected');
    byId('systemRouteAddress').textContent = environment?.systemRoute?.sourceAddress || '—';
    const proxy = environment?.systemProxy || {};
    const owner = proxy.owner || {};
    byId('systemProxyName').textContent = proxy.state === 'detected'
      ? (owner.name || (owner.provider && owner.provider !== 'unknown' ? owner.provider : t('connect.localProxy'))) :
      t(proxy.state === 'disabled' ? 'connect.proxyDisabled' : 'connect.notDetected');
    const endpoint = proxy.endpoint ? `${proxy.endpoint.host}:${proxy.endpoint.port}` : '';
    const mode = owner.mode && owner.mode !== 'unknown' ? t(`connect.proxyMode.${owner.mode}`) : t('connect.modeUnknown');
    byId('systemProxyMode').textContent = proxy.state === 'detected'
      ? [mode, owner.tunEnabled === true ? t('connect.tunEnabled') : owner.tunEnabled === false ? t('connect.tunDisabled') : '', endpoint].filter(Boolean).join(' · ')
      : '—';
    const virtual = interfaces.filter(({ kind, active, systemDefault, addresses }) => (
      kind === 'virtual' && active && (systemDefault || addresses.some(({ selectable }) => selectable))
    ));
    byId('virtualAdapterSummary').textContent = virtual.length
      ? t('connect.virtualCount', { count: virtual.length }) : t('connect.noneDetected');
    byId('virtualAdapterDetail').textContent = virtual.map(({ name, id }) => name === id ? id : `${name} (${id})`).join(' · ') || '—';
    for (const id of ['defaultAdapterName', 'defaultAdapterAddress', 'systemRouteName',
      'systemRouteAddress', 'systemProxyName', 'systemProxyMode', 'virtualAdapterSummary',
      'virtualAdapterDetail']) byId(id).title = byId(id).textContent;

    const select = byId('underlaySourceAddress');
    const previous = select.value;
    const options = [];
    const defaultLabel = defaultAdapter
      ? t('connect.defaultDirectOption', { name: defaultAdapter.name,
        address: environment.defaultRoute?.sourceAddress || '—' })
      : t('connect.defaultDirect');
    options.push({ value: '', label: defaultLabel });
    for (const item of interfaces.filter(({ active, kind }) => active && kind !== 'loopback')) {
      for (const candidate of item.addresses || []) {
        if (!candidate.selectable) continue;
        options.push({ value: candidate.address,
          label: `${item.name} (${item.id}) · ${candidate.address}${item.kind === 'virtual' ? ` · ${t('connect.virtual')}` : ''}` });
      }
    }
    select.replaceChildren(...options.map(({ value, label }) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
    }));
    const selected = environment.selection?.mode === 'selected' ? environment.selection.sourceAddress : '';
    select.value = options.some(({ value }) => value === selected) ? selected : previous && options.some(({ value }) => value === previous) ? previous : '';
    select.disabled = savingUnderlay;
    byId('localNetworkSummary').textContent = environment.selection?.mode === 'selected'
      ? t('connect.selectedUnderlay', { name: interfaces.find(({ id }) => id === environment.selection.interfaceId)?.name || environment.selection.interfaceId,
        address: environment.selection.sourceAddress })
      : t('connect.defaultUnderlay', { name: defaultAdapter?.name || t('connect.notDetected'),
        address: environment.defaultRoute?.sourceAddress || '—' });
  }

  function renderTelemetry(telemetry = {}, t = translate) {
    if (Number.isFinite(telemetry.latencyMs)) {
      latencyHistory.push(telemetry.latencyMs);
      if (latencyHistory.length > 24) latencyHistory.shift();
    }
    const svg = byId('latencySparkline');
    if (svg) svg.innerHTML = `<path d="${sparkline(latencyHistory)}"/>`;
    const names = Array.isArray(telemetry.apps) ? telemetry.apps.map(({ name }) => name).filter(Boolean) : [];
    const proxy = byId('proxyObservation');
    const proxyNames = names.filter((name) => /clash|mihomo/i.test(name));
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
    if (typeof options.save === 'function') saveSettings = options.save;
    if (typeof options.refresh === 'function') refreshState = options.refresh;
    byId('localNetworkSummary').textContent = translate('connect.detecting');
    byId('copyTunnelIp').addEventListener('click', async () => {
      const value = byId('stIp').textContent.trim();
      if (!value || value === '—' || !copyText) return;
      await copyText(value);
      const button = byId('copyTunnelIp');
      const previous = button.textContent;
      button.textContent = translate('connect.copied');
      window.setTimeout(() => { button.textContent = previous; }, 1200);
    });
    byId('underlaySourceAddress').addEventListener('change', async (event) => {
      if (!saveSettings || savingUnderlay) return;
      savingUnderlay = true; event.currentTarget.disabled = true;
      const status = byId('underlaySelectionStatus'); status.textContent = translate('connect.applyingUnderlay');
      try {
        const result = await saveSettings({ underlaySourceAddress: event.currentTarget.value });
        status.textContent = result?.ok ? translate('connect.underlayApplied') : (result?.error || translate('tower.saveFailed'));
        await refreshState?.();
      } catch (error) { status.textContent = error?.message || translate('tower.saveFailed'); }
      finally { savingUnderlay = false; event.currentTarget.disabled = false; }
    });
  }

  const api = Object.freeze({ renderEnvironment, renderStatus, renderTelemetry, sparkline, start });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.connectionOverview = api;
})(typeof window !== 'undefined' ? window : null);
