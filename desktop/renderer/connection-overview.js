'use strict';

(function initializeConnectionOverview(globalScope) {
  const latencyHistory = [];
  const byId = (id) => document.getElementById(id);
  let translate = (key) => key;
  let copyText = null;
  let saveSettings = null;
  let refreshState = null;
  let getEnvironment = null;
  let environmentRequest = null;
  let savingUnderlay = false;

  function buildUnderlayOptions(environment = {}, t = (key) => key) {
    const interfaces = Array.isArray(environment.interfaces) ? environment.interfaces : [];
    const defaultAdapter = interfaces.find(({ default: activeDefault }) => activeDefault) || null;
    const defaultAddress = environment.defaultRoute?.sourceAddress || '';
    const selectionAvailable = environment.selection?.available !== false;
    const rawSelected = environment.selection?.mode === 'selected'
      ? environment.selection.sourceAddress : '';
    const selectedValue = selectionAvailable ? (rawSelected === defaultAddress ? '' : rawSelected) : null;
    const ordered = interfaces.filter(({ active, kind }) => active && kind !== 'loopback')
      .sort((left, right) => Number(right.id === environment.selection?.interfaceId) -
        Number(left.id === environment.selection?.interfaceId) ||
        Number(right.default === true) - Number(left.default === true));
    const options = [];
    for (const item of ordered) {
      const seen = new Set();
      const sources = [];
      const candidates = (item.addresses || []).filter(({ selectable }) => selectable)
        .sort((left, right) => Number(right.address === defaultAddress) -
          Number(left.address === defaultAddress) || left.family - right.family);
      for (const candidate of candidates) {
        if (seen.has(candidate.address)) continue;
        seen.add(candidate.address);
        const value = item === defaultAdapter && candidate.address === defaultAddress
          ? '' : candidate.address;
        sources.push({
          value,
          localAddress: candidate.address,
          family: candidate.family,
          publicEgress: candidate.publicEgress || null,
          selected: selectionAvailable && selectedValue === value &&
            (value === '' || item.id === environment.selection?.interfaceId),
        });
      }
      if (!sources.length && item === defaultAdapter && defaultAddress) {
        sources.push({ value: '', localAddress: defaultAddress, family: 0,
          publicEgress: null, selected: selectionAvailable && selectedValue === '' });
      }
      if (!sources.length) continue;
      options.push({
        interfaceId: item.id,
        title: item.name === item.id ? item.name : `${item.name} · ${item.id}`,
        kind: item.kind,
        badge: t(item.kind === 'virtual' ? 'connect.treeVirtual' : 'connect.treePhysical'),
        selected: sources.some(({ selected }) => selected),
        sources,
      });
    }
    if (!options.length) {
      options.push({ interfaceId: '', title: t('connect.defaultDirect'), kind: 'unknown',
        badge: t('connect.treeDefault'), selected: selectionAvailable,
        sources: [{ value: '', localAddress: defaultAddress || '', family: 0,
          publicEgress: null, selected: selectionAvailable }] });
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
    const focusedAddress = document.activeElement?.dataset?.underlayAddress;
    optionContainer.setAttribute('role', 'radiogroup');
    optionContainer.setAttribute('aria-label', t('connect.treeUnderlay'));
    optionContainer.replaceChildren(...options.map((option) => {
      const card = document.createElement('section');
      card.className = `network-underlay-interface${option.selected ? ' active' : ''}`;
      card.dataset.underlayInterface = option.interfaceId;
      const line = document.createElement('span'); line.className = 'network-underlay-line';
      line.setAttribute('aria-hidden', 'true');
      const heading = document.createElement('div'); heading.className = 'network-interface-heading';
      const icon = document.createElement('span'); icon.className = 'network-tree-icon';
      icon.setAttribute('aria-hidden', 'true'); icon.textContent = option.kind === 'virtual' ? '◇' : '⇄';
      const title = document.createElement('strong'); title.textContent = option.title;
      const badge = document.createElement('span'); badge.className = 'network-underlay-badge';
      badge.textContent = option.selected ? t('connect.treeCurrent') : option.badge;
      heading.append(icon, title, badge);
      const sourceList = document.createElement('div'); sourceList.className = 'network-source-list';
      for (const source of option.sources) {
        const egress = source.publicEgress;
        const publicText = egress?.status === 'ready'
          ? t('connect.publicEgressValue', { address: egress.address })
          : t(egress?.status === 'probing' ? 'connect.publicEgressDetecting'
            : egress?.status === 'unavailable' ? 'connect.publicEgressUnavailable'
              : 'connect.publicEgressPending');
        const relationKey = egress?.relation === 'baseline' ? 'connect.egressBaseline'
          : egress?.relation === 'same' ? 'connect.egressSame'
            : egress?.relation === 'different' ? 'connect.egressDifferent'
              : 'connect.egressUnknown';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `network-underlay-source${source.selected ? ' active' : ''}`;
        button.dataset.underlayAddress = source.value;
        button.disabled = savingUnderlay;
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', String(source.selected));
        button.setAttribute('aria-label', t('connect.treeUseUnderlayObserved', {
          name: option.title,
          local: source.localAddress || t('connect.notDetected'),
          public: publicText,
          relation: t(relationKey),
        }));
        const marker = document.createElement('span'); marker.className = 'network-source-marker';
        marker.setAttribute('aria-hidden', 'true');
        const copy = document.createElement('span'); copy.className = 'network-underlay-copy';
        const publicLine = document.createElement('strong'); publicLine.textContent = publicText;
        const localLine = document.createElement('small');
        localLine.textContent = t('connect.localAddressValue', {
          address: source.localAddress || t('connect.notDetected'),
        });
        copy.append(publicLine, localLine);
        const relation = document.createElement('span'); relation.className = `network-egress-relation ${egress?.relation || 'unknown'}`;
        relation.textContent = t(relationKey);
        button.append(marker, copy, relation);
        sourceList.append(button);
      }
      card.append(line, heading, sourceList);
      return card;
    }));
    if (focusedAddress !== undefined) {
      const target = [...optionContainer.querySelectorAll('[data-underlay-address]')]
        .find((node) => node.dataset.underlayAddress === focusedAddress);
      target?.focus?.({ preventScroll: true });
    }
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

  function refreshEnvironment(enabled = true) {
    if (enabled !== true || !getEnvironment || environmentRequest || document.hidden) {
      return environmentRequest || Promise.resolve(null);
    }
    environmentRequest = Promise.resolve().then(() => getEnvironment()).then((environment) => {
      if (environment && typeof environment === 'object') renderEnvironment(environment, translate);
      return environment;
    }).catch(() => null).finally(() => { environmentRequest = null; });
    return environmentRequest;
  }

  function start(options = {}) {
    if (typeof options.translate === 'function') translate = options.translate;
    if (typeof options.copy === 'function') copyText = options.copy;
    if (typeof options.save === 'function') saveSettings = options.save;
    if (typeof options.refresh === 'function') refreshState = options.refresh;
    if (typeof options.getEnvironment === 'function') getEnvironment = options.getEnvironment;
    if (typeof options.subscribeEnvironment === 'function') {
      options.subscribeEnvironment((environment) => renderEnvironment(environment, translate));
    }
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
      if (!target || target.getAttribute('aria-checked') === 'true') return;
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

  const api = Object.freeze({ buildUnderlayOptions, refreshEnvironment, renderEnvironment, renderStatus, renderTelemetry, sparkline, start });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.connectionOverview = api;
})(typeof window !== 'undefined' ? window : null);
