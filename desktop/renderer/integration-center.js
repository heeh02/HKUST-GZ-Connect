(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.integrationCenter = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const ADAPTERS = new Set([
    'clash_yaml', 'mihomo_yaml', 'clash_verge_rev_managed',
    'openssh_proxy_command', 'pac', 'manual_export',
  ]);
  const ACTIONS = new Set(['copy', 'save', 'install', 'update', 'remove']);
  const STATES = new Set(['not-installed', 'current', 'stale', 'unavailable']);
  const COMPATIBILITY = new Set(['supported', 'unsupported', 'unavailable', 'conflict']);
  const HANDLES = /^(?:export|managed)-[a-f0-9]{32}$/u;

  function adapterView(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.schemaVersion !== 1 || !ADAPTERS.has(value.adapterId) ||
        !COMPATIBILITY.has(value.compatibilityState) || !STATES.has(value.bindingState) ||
        !Array.isArray(value.supportedActions) ||
        value.supportedActions.some((action) => !ACTIONS.has(action) && action !== 'preview') ||
        (value.updatedAt !== null && (!Number.isSafeInteger(value.updatedAt) || value.updatedAt <= 0))) {
      return null;
    }
    return Object.freeze({
      adapterId: value.adapterId,
      compatibilityState: value.compatibilityState,
      bindingState: value.bindingState,
      updatedAt: value.updatedAt,
    });
  }

  function previewView(value, now = Date.now()) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 ||
        !ADAPTERS.has(value.adapterId) || !ACTIONS.has(value.action) ||
        typeof value.confirmationHandle !== 'string' || !HANDLES.test(value.confirmationHandle) ||
        !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now ||
        typeof value.containsLocalProxyCredential !== 'boolean') return null;
    const changes = value.changes && typeof value.changes === 'object'
      ? Object.fromEntries(['create', 'replace', 'remove', 'unchanged'].map((key) => [
        key, Number.isSafeInteger(value.changes[key]) && value.changes[key] >= 0
          ? value.changes[key] : 0,
      ]))
      : {
          create: value.targetChange === 'create' ? 1 : 0,
          replace: value.targetChange === 'replace' ? 1 : 0,
          remove: 0,
          unchanged: value.targetChange === 'unchanged' ? 1 : 0,
        };
    const warnings = Array.isArray(value.warningCodes)
      ? value.warningCodes
      : (typeof value.warningCode === 'string' ? [value.warningCode] : []);
    if (warnings.some((code) => !/^INTEGRATION_[A-Z_]+$/u.test(code))) return null;
    return Object.freeze({
      confirmationHandle: value.confirmationHandle,
      adapterId: value.adapterId,
      action: value.action,
      expiresAt: value.expiresAt,
      changes: Object.freeze(changes),
      byteLength: Number.isSafeInteger(value.byteLength) && value.byteLength >= 0
        ? value.byteLength : 0,
      ruleCount: Number.isSafeInteger(value.ruleCount) && value.ruleCount >= 0
        ? value.ruleCount : 0,
      containsLocalProxyCredential: value.containsLocalProxyCredential,
      warnings: Object.freeze([...warnings]),
    });
  }

  function createIntegrationCenter({
    api,
    document,
    translate,
    now = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    for (const method of [
      'listIntegrations', 'prepareIntegration', 'confirmIntegration', 'cancelIntegration',
    ]) {
      if (typeof api?.[method] !== 'function') throw new TypeError('Integration Center API is incomplete');
    }
    if (!document || typeof document.getElementById !== 'function' ||
        typeof document.createElement !== 'function' || typeof translate !== 'function') {
      throw new TypeError('Integration Center renderer environment is incomplete');
    }
    const ids = [
      'integrationList', 'integrationStatus', 'integrationError', 'integrationDialog',
      'integrationPreviewName', 'integrationPreviewSummary', 'integrationPreviewWarnings',
      'integrationDialogError', 'closeIntegrationDialog', 'cancelIntegration', 'confirmIntegration',
    ];
    const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    if (Object.values(elements).some((element) => !element)) {
      throw new TypeError('Integration Center markup is incomplete');
    }
    let t = translate;
    let views = [];
    let preview = null;
    let timer = null;
    let busy = false;
    let bound = false;

    function errorMessage(code) {
      const specific = new Set([
        'INTEGRATION_ADAPTER_UNAVAILABLE', 'INTEGRATION_PROFILE_STALE',
        'INTEGRATION_AUTH_INCOMPATIBLE', 'INTEGRATION_EXPORT_CANCELLED',
        'INTEGRATION_EXPORT_TARGET_INVALID', 'INTEGRATION_EXPORT_CONFLICT',
        'INTEGRATION_TARGET_CHANGED', 'INTEGRATION_ROLLBACK_INCOMPLETE',
      ]);
      return t(`integration.error.${specific.has(code) ? code : 'generic'}`);
    }
    function clearTimer() {
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
    }
    function closeDialog() {
      clearTimer();
      preview = null;
      elements.integrationDialogError.textContent = '';
      if (elements.integrationDialog.open) elements.integrationDialog.close();
    }
    function button(label, action, adapterId, danger = false) {
      const value = document.createElement('button');
      value.type = 'button';
      value.className = `mini${danger ? ' danger-action' : ''}`;
      value.dataset.integrationAction = action;
      value.textContent = label;
      value.disabled = busy;
      value.addEventListener('click', () => prepare(adapterId, action));
      return value;
    }
    function render() {
      const rows = [];
      for (const view of views.filter((value) => value.compatibilityState !== 'unavailable')) {
        const row = document.createElement('div'); row.className = 'integration-row';
        row.dataset.integrationAdapter = view.adapterId;
        const main = document.createElement('div'); main.className = 'integration-main';
        const name = document.createElement('div'); name.className = 'integration-name';
        name.textContent = t(`integration.adapter.${view.adapterId}`);
        const meta = document.createElement('div'); meta.className = 'integration-meta';
        const state = document.createElement('span');
        state.className = `integration-state ${view.bindingState}`;
        state.textContent = t(`integration.state.${view.bindingState}`);
        meta.append(state); main.append(name, meta);
        const actions = document.createElement('div'); actions.className = 'integration-actions';
        if (GENERIC.has(view.adapterId)) {
          actions.append(
            button(t('integration.action.copy'), 'copy', view.adapterId),
            button(t('integration.action.save'), 'save', view.adapterId),
          );
        } else if (view.bindingState === 'not-installed') {
          actions.append(button(t('integration.action.install'), 'install', view.adapterId));
        } else {
          actions.append(
            button(t('integration.action.update'), 'update', view.adapterId),
            button(t('integration.action.remove'), 'remove', view.adapterId, true),
          );
        }
        row.append(main, actions); rows.push(row);
      }
      elements.integrationList.replaceChildren(...rows);
      elements.integrationStatus.textContent = rows.length ? '' : t('integration.empty');
    }
    const GENERIC = new Set(['clash_yaml', 'mihomo_yaml', 'pac', 'manual_export']);
    function renderPreview() {
      if (!preview) return;
      elements.integrationPreviewName.textContent = t(`integration.adapter.${preview.adapterId}`);
      const summaries = [
        t('integration.summaryAction', { action: t(`integration.action.${preview.action}`) }),
        t('integration.summaryFiles', preview.changes),
      ];
      if (preview.byteLength) summaries.push(t('integration.summaryBytes', { bytes: preview.byteLength }));
      if (preview.ruleCount) summaries.push(t('integration.summaryRules', { rules: preview.ruleCount }));
      elements.integrationPreviewSummary.replaceChildren(...summaries.map((text) => {
        const item = document.createElement('div'); item.className = 'integration-preview-chip';
        item.textContent = text; return item;
      }));
      elements.integrationPreviewWarnings.replaceChildren(...preview.warnings.map((code) => {
        const item = document.createElement('p'); item.className = 'integration-warning';
        item.textContent = t(`integration.warning.${code}`); return item;
      }));
    }
    async function refresh() {
      const result = await api.listIntegrations();
      if (!result?.ok || !Array.isArray(result.integrations)) {
        views = [];
        elements.integrationError.textContent = errorMessage(result?.code);
        render(); return false;
      }
      const normalized = result.integrations.map(adapterView).filter(Boolean);
      views = normalized.filter((view) => ADAPTERS.has(view.adapterId));
      elements.integrationError.textContent = '';
      render(); return true;
    }
    async function prepare(adapterId, action) {
      if (busy) return;
      busy = true; render(); elements.integrationError.textContent = '';
      let result;
      try { result = await api.prepareIntegration({ adapterId, action }); }
      catch { result = { ok: false, code: 'generic' }; }
      busy = false; render();
      if (!result?.ok) {
        if (result?.code !== 'INTEGRATION_EXPORT_CANCELLED') {
          elements.integrationError.textContent = errorMessage(result?.code);
        }
        return;
      }
      preview = previewView(result.preview, now());
      if (!preview) {
        await api.cancelIntegration().catch(() => {});
        elements.integrationError.textContent = errorMessage('generic');
        return;
      }
      renderPreview();
      elements.integrationDialog.showModal();
      timer = setTimeoutFn(() => {
        api.cancelIntegration().catch(() => {});
        closeDialog();
        elements.integrationError.textContent = errorMessage('INTEGRATION_TARGET_CHANGED');
      }, Math.max(0, preview.expiresAt - now()));
      timer?.unref?.();
    }
    async function confirm() {
      if (!preview || busy) return;
      const handle = preview.confirmationHandle;
      busy = true; elements.confirmIntegration.disabled = true;
      let result;
      try { result = await api.confirmIntegration({ confirmationHandle: handle }); }
      catch { result = { ok: false, code: 'generic' }; }
      busy = false; elements.confirmIntegration.disabled = false;
      if (!result?.ok) {
        const message = errorMessage(result?.code);
        closeDialog();
        elements.integrationError.textContent = message;
        return;
      }
      closeDialog();
      await refresh();
      elements.integrationStatus.textContent = t('integration.success');
    }
    async function cancel() {
      await api.cancelIntegration().catch(() => {});
      closeDialog();
    }
    function bind() {
      if (bound) return;
      bound = true;
      elements.confirmIntegration.addEventListener('click', confirm);
      elements.cancelIntegration.addEventListener('click', cancel);
      elements.closeIntegrationDialog.addEventListener('click', cancel);
      elements.integrationDialog.addEventListener('cancel', (event) => {
        event.preventDefault(); cancel();
      });
    }
    function setTranslator(next) {
      if (typeof next !== 'function') return;
      t = next; render(); renderPreview();
    }
    function start() { bind(); render(); }
    return Object.freeze({ cancel, confirm, prepare, refresh, setTranslator, start });
  }

  return { adapterView, createIntegrationCenter, previewView };
});

if (typeof window !== 'undefined' && window.document && window.api && window.I18N) {
  const locale = () => window.document.documentElement.lang?.startsWith('zh') ? 'zh' : 'en';
  const feature = window.integrationCenter.createIntegrationCenter({
    api: window.api,
    document: window.document,
    translate: window.I18N.createT(locale()),
  });
  window.document.addEventListener('app-locale-changed', () => {
    feature.setTranslator(window.I18N.createT(locale()));
  });
  window.document.addEventListener('app-state-refreshed', (event) => {
    if (event.detail?.loggedIn === true) feature.refresh().catch(() => {});
  });
  feature.start();
  window.integrationCenterFeature = feature;
}
