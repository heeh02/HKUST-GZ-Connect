'use strict';

(function initializeConnectionOverview(globalScope) {
  const latencyHistory = [];
  const byId = (id) => document.getElementById(id);
  let translate = (key) => key;
  let copyText = null;
  let saveSettings = null;
  let refreshState = null;
  let savingUnderlay = false;

  function buildUnderlayOptions(environment = {}, t = (key) => key) {
    const interfaces = Array.isArray(environment.interfaces) ? environment.interfaces : [];
    const defaultAdapter = interfaces.find(({ default: activeDefault }) => activeDefault) || null;
    const defaultAddress = environment.defaultRoute?.sourceAddress || '';
    const selectionAvailable = environment.selection?.available !== false;
    const rawSelected = environment.selection?.mode === 'selected'
      ? environment.selection.sourceAddress : '';
    const selectedValue = selectionAvailable ? (rawSelected === defaultAddress ? '' : rawSelected) : null;
    const options = [{
      value: '',
      interfaceId: defaultAdapter?.id || '',
      title: defaultAdapter ? `${defaultAdapter.name} · ${defaultAdapter.id}` : t('connect.defaultDirect'),
      detail: defaultAddress || t('connect.notDetected'),
      kind: defaultAdapter?.kind || 'unknown',
      badge: t('connect.treeDefault'),
      selected: selectedValue === '',
    }];
    const seen = new Set([defaultAddress].filter(Boolean));
    for (const item of interfaces.filter(({ active, kind }) => active && kind !== 'loopback')) {
      for (const candidate of item.addresses || []) {
        if (!candidate.selectable || seen.has(candidate.address)) continue;
        seen.add(candidate.address);
        options.push({
          value: candidate.address,
          interfaceId: item.id,
          title: `${item.name} · ${item.id}`,
          detail: candidate.address,
          kind: item.kind,
          badge: t(item.kind === 'virtual' ? 'connect.treeVirtual' : 'connect.treePhysical'),
          selected: selectedValue === candidate.address,
        });
      }
    }
    return options;
  }

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
    const tunnelNode = document.querySelector('[data-topology-node="tunnel"]');
    tunnelNode.dataset.status = connected ? 'healthy' : busy ? 'warning' : state.lastError ? 'error' : 'inactive';
    byId('tunnelSummary').textContent = t(connected ? 'connect.tunnelReady' : busy ? 'connect.tunnelConnecting' : 'connect.tunnelInactive');
    byId('notificationAttention').hidden = !state.lastError && !state.notice;
    if (state.networkEnvironment) renderEnvironment(state.networkEnvironment, t);
  }

  function renderEnvironment(environment, t = translate) {
    const optionContainer = byId('underlayTreeOptions');
    const options = buildUnderlayOptions(environment, t);
    optionContainer.replaceChildren(...options.map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `network-underlay-option${option.selected ? ' active' : ''}`;
      button.dataset.underlayAddress = option.value;
      button.disabled = savingUnderlay;
      button.setAttribute('aria-pressed', String(option.selected));
      button.setAttribute('aria-label', t('connect.treeUseUnderlay', {
        name: option.title, address: option.detail,
      }));
      const line = document.createElement('span'); line.className = 'network-underlay-line';
      line.setAttribute('aria-hidden', 'true');
      const icon = document.createElement('span'); icon.className = 'network-tree-icon';
      icon.setAttribute('aria-hidden', 'true'); icon.textContent = option.kind === 'virtual' ? '◇' : '⇄';
      const copy = document.createElement('span'); copy.className = 'network-underlay-copy';
      const title = document.createElement('strong'); title.textContent = option.title;
      const detail = document.createElement('small'); detail.textContent = option.detail;
      copy.append(title, detail);
      const badge = document.createElement('span'); badge.className = 'network-underlay-badge';
      badge.textContent = option.selected ? t('connect.treeCurrent') : option.badge;
      button.append(line, icon, copy, badge);
      return button;
    }));
    optionContainer.dataset.available = String(environment.selection?.available !== false);
  }

  function renderTelemetry(telemetry = {}, t = translate) {
    if (Number.isFinite(telemetry.latencyMs)) {
      latencyHistory.push(telemetry.latencyMs);
      if (latencyHistory.length > 24) latencyHistory.shift();
    }
    const svg = byId('latencySparkline');
    if (svg) svg.innerHTML = `<path d="${sparkline(latencyHistory)}"/>`;
  }

  function start(options = {}) {
    if (typeof options.translate === 'function') translate = options.translate;
    if (typeof options.copy === 'function') copyText = options.copy;
    if (typeof options.save === 'function') saveSettings = options.save;
    if (typeof options.refresh === 'function') refreshState = options.refresh;
    byId('copyTunnelIp').addEventListener('click', async () => {
      const value = byId('stIp').textContent.trim();
      if (!value || value === '—' || !copyText) return;
      await copyText(value);
      const button = byId('copyTunnelIp');
      const previous = button.textContent;
      button.textContent = translate('connect.copied');
      window.setTimeout(() => { button.textContent = previous; }, 1200);
    });
    byId('underlayTreeOptions').addEventListener('click', async (event) => {
      const target = event.target.closest('[data-underlay-address]');
      if (!target || target.getAttribute('aria-pressed') === 'true') return;
      if (!saveSettings || savingUnderlay) return;
      savingUnderlay = true;
      for (const button of byId('underlayTreeOptions').querySelectorAll('button')) button.disabled = true;
      target.classList.add('pending');
      const status = byId('underlaySelectionStatus'); status.textContent = translate('connect.applyingUnderlay');
      try {
        const result = await saveSettings({ underlaySourceAddress: target.dataset.underlayAddress });
        status.textContent = result?.ok ? translate('connect.underlayApplied') : (result?.error || translate('tower.saveFailed'));
        await refreshState?.();
      } catch (error) { status.textContent = error?.message || translate('tower.saveFailed'); }
      finally {
        savingUnderlay = false; target.classList.remove('pending');
        for (const button of byId('underlayTreeOptions').querySelectorAll('button')) button.disabled = false;
      }
    });
  }

  const api = Object.freeze({ buildUnderlayOptions, renderEnvironment, renderStatus, renderTelemetry, sparkline, start });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.connectionOverview = api;
})(typeof window !== 'undefined' ? window : null);
