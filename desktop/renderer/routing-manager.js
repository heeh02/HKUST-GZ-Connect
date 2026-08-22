(function (root, factory) {
  const shared = typeof module !== 'undefined' && module.exports
    ? require('./manager-view')
    : root.managerView;
  const api = factory(root, shared);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.routingManager = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root, shared) {
  'use strict';

  function normalizeRoutingHostInput(value, translate) {
    const source = String(value || '').trim();
    if (!source || source.length > 254 || /[\u0000-\u0020\u007f:/@*?#\\]/u.test(source)
        || source.startsWith('.') || source.endsWith('..')) {
      throw new Error(translate('routing.invalidHost'));
    }
    const withoutRootDot = source.endsWith('.') ? source.slice(0, -1) : source;
    let host;
    try {
      host = new URL(`https://${withoutRootDot}`).hostname.toLowerCase().replace(/\.$/, '');
    } catch {
      throw new Error(translate('routing.invalidHost'));
    }
    if (!host || host.length > 253 || host.includes('..') || host.split('.').some((label) => (
      !label || label.length > 63 || !/^[a-z0-9-]+$/u.test(label)
      || label.startsWith('-') || label.endsWith('-')
    ))) {
      throw new Error(translate('routing.invalidHost'));
    }
    return host;
  }

  function routingRulesForView(input) {
    return (Array.isArray(input) ? input : []).filter((rule) => (
      rule && typeof rule.host === 'string' && rule.host.length <= 253
      && typeof rule.includeSubdomains === 'boolean'
      && (rule.route === 'campus' || rule.route === 'direct')
    )).slice(0, 128).map((rule) => ({
      host: rule.host,
      includeSubdomains: rule.includeSubdomains,
      route: rule.route,
      updatedAt: rule.updatedAt,
    }));
  }

  function createRoutingManager({
    api,
    document: doc,
    i18n,
    openTower = () => {},
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    if (!api || !doc || !i18n || typeof openTower !== 'function' || !shared) {
      throw new TypeError('routing manager dependencies are required');
    }
    const $ = (id) => doc.getElementById(id);
    const dialog = $('routingRulesDialog');
    const translate = (key, vars) => i18n.createT(
      i18n.resolveLocale(doc.documentElement.lang),
    )(key, vars);
    let rules = [];
    let busy = false;
    let pendingDeleteKey = '';
    let pendingDeleteTimer = null;
    let started = false;

    const ruleKey = (rule) => `${rule.host}|${rule.includeSubdomains === true ? '1' : '0'}`;
    const disarmDelete = () => {
      pendingDeleteKey = '';
      clearTimeoutFn(pendingDeleteTimer);
      pendingDeleteTimer = null;
    };

    function renderList() {
      const esc = shared.escapeHtml;
      $('routingRuleList').innerHTML = rules.map((rule, index) => {
        const pending = pendingDeleteKey === ruleKey(rule);
        const disabled = busy ? ' disabled' : '';
        const actions = pending
          ? `<button class="mini confirm-action" type="button" data-routing-action="delete" data-routing-index="${index}"${disabled}>${esc(translate('routing.confirmDelete'))}</button>`
            + `<button class="mini" type="button" data-routing-action="cancel-delete" data-routing-index="${index}"${disabled}>${esc(translate('routing.cancelDelete'))}</button>`
          : `<button class="mini" type="button" data-routing-action="edit" data-routing-index="${index}"${disabled}>${esc(translate('routing.edit'))}</button>`
            + `<button class="mini danger-action" type="button" data-routing-action="delete" data-routing-index="${index}"${disabled}>${esc(translate('routing.delete'))}</button>`;
        return `<div class="manager-item routing-rule-item" role="listitem">`
          + `<div class="manager-item-main"><div class="manager-item-title">${esc(rule.host)}</div>`
          + `<div class="manager-item-details"><span class="manager-chip">${esc(rule.includeSubdomains ? translate('routing.scopeSubdomains') : translate('routing.scopeExact'))}</span>`
          + `<span class="manager-chip ${rule.route}">${esc(rule.route === 'direct' ? translate('routing.routeDirect') : translate('routing.routeCampus'))}</span>`
          + `<span class="manager-time">${esc(translate('routing.updated', { time: shared.formatManagerTime(rule.updatedAt, translate, doc) }))}</span></div></div>`
          + `<div class="manager-item-actions">${actions}</div></div>`;
      }).join('');
      $('routingRuleListStatus').textContent = rules.length ? '' : translate('routing.empty');
    }

    function updateFormMode() {
      const host = $('routingOriginalHost').value;
      const editing = !!host;
      $('saveRoutingRule').textContent = editing ? translate('routing.save') : translate('routing.add');
      $('cancelRoutingRule').textContent = editing
        ? translate('routing.cancelEdit')
        : translate('routing.clear');
      $('routingRuleEditHint').textContent = editing
        ? translate('routing.editing', { host })
        : '';
    }

    function clearForm({ keepMessages = false } = {}) {
      $('routingOriginalHost').value = '';
      $('routingOriginalScope').value = '';
      $('routingRuleHost').value = '';
      $('routingRuleScope').value = 'exact';
      $('routingRuleRoute').value = 'campus';
      if (!keepMessages) {
        $('routingRuleError').textContent = '';
        $('routingRuleSaved').textContent = '';
      }
      updateFormMode();
      doc.querySelectorAll('.routing-rule-item').forEach((row) => row.classList.remove('active'));
    }

    function editRule(rule, index) {
      disarmDelete();
      $('routingOriginalHost').value = rule.host;
      $('routingOriginalScope').value = rule.includeSubdomains ? 'subdomains' : 'exact';
      $('routingRuleHost').value = rule.host;
      $('routingRuleScope').value = rule.includeSubdomains ? 'subdomains' : 'exact';
      $('routingRuleRoute').value = rule.route;
      $('routingRuleError').textContent = '';
      $('routingRuleSaved').textContent = '';
      updateFormMode();
      doc.querySelectorAll('.routing-rule-item').forEach((row, rowIndex) => {
        row.classList.toggle('active', rowIndex === index);
      });
      $('routingRuleHost').focus();
    }

    function setBusy(nextBusy) {
      busy = nextBusy;
      $('routingRuleForm').setAttribute('aria-busy', String(nextBusy));
      $('routingRuleForm').querySelectorAll('input, select, button').forEach((control) => {
        control.disabled = nextBusy;
      });
      renderList();
    }

    async function load() {
      $('routingRuleList').innerHTML = '';
      $('routingRuleListStatus').textContent = translate('routing.loading');
      $('routingRuleError').textContent = '';
      try {
        const result = await api.listRoutingRules();
        if (result?.ok === false) {
          throw new Error(shared.operationError(result, translate('routing.loadFailed')));
        }
        const next = shared.collectionFromResult(result, 'rules');
        if (!next) throw new Error(translate('routing.loadFailed'));
        rules = routingRulesForView(next);
        renderList();
        return true;
      } catch (error) {
        rules = [];
        $('routingRuleList').innerHTML = '';
        $('routingRuleListStatus').textContent = '';
        $('routingRuleError').textContent = error?.message || translate('routing.loadFailed');
        return false;
      }
    }

    async function open() {
      if (dialog.open && busy) return;
      disarmDelete();
      clearForm();
      if (!dialog.open) dialog.showModal();
      setBusy(true);
      let loaded = false;
      try { loaded = await load(); }
      finally { setBusy(false); }
      if (loaded) $('routingRuleHost').focus();
    }

    function start() {
      if (started) return false;
      started = true;
      $('manageRoutingRules').addEventListener('click', open);
      $('closeRoutingRulesDialog').addEventListener('click', () => dialog.close());
      $('cancelRoutingRule').addEventListener('click', () => clearForm());
      dialog.addEventListener('close', disarmDelete);
      api.onOpenRoutingRules?.(() => {
        openTower();
        open();
      });
      $('routingRuleList').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-routing-action]');
        const index = Number(button?.dataset.routingIndex);
        const rule = Number.isInteger(index) ? rules[index] : null;
        if (!button || !rule || busy) return;
        if (button.dataset.routingAction === 'cancel-delete') {
          disarmDelete();
          renderList();
          return;
        }
        if (button.dataset.routingAction === 'edit') {
          editRule(rule, index);
          return;
        }
        if (button.dataset.routingAction !== 'delete') return;
        if (pendingDeleteKey !== ruleKey(rule)) {
          pendingDeleteKey = ruleKey(rule);
          clearTimeoutFn(pendingDeleteTimer);
          pendingDeleteTimer = setTimeoutFn(() => {
            disarmDelete();
            renderList();
          }, 4000);
          renderList();
          return;
        }
        disarmDelete();
        setBusy(true);
        $('routingRuleError').textContent = '';
        $('routingRuleSaved').textContent = '';
        try {
          const result = await api.deleteRoutingRule({
            host: rule.host,
            includeSubdomains: rule.includeSubdomains,
          });
          if (result?.ok === false) {
            throw new Error(shared.operationError(result, translate('routing.deleteFailed')));
          }
          const next = shared.collectionFromResult(result, 'rules');
          if (next) {
            rules = routingRulesForView(next);
            renderList();
          } else {
            await load();
          }
          if ($('routingOriginalHost').value === rule.host
              && ($('routingOriginalScope').value === 'subdomains') === rule.includeSubdomains) {
            clearForm({ keepMessages: true });
          }
          $('routingRuleSaved').textContent = translate('routing.deleted');
        } catch (error) {
          $('routingRuleError').textContent = error?.message || translate('routing.deleteFailed');
        } finally {
          setBusy(false);
        }
      });
      $('routingRuleForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        $('routingRuleError').textContent = '';
        $('routingRuleSaved').textContent = '';
        let host;
        try {
          host = normalizeRoutingHostInput($('routingRuleHost').value, translate);
        } catch (error) {
          $('routingRuleError').textContent = error?.message || translate('routing.invalidHost');
          $('routingRuleHost').focus();
          return;
        }
        const scope = $('routingRuleScope').value;
        const route = $('routingRuleRoute').value;
        if (!['exact', 'subdomains'].includes(scope) || !['campus', 'direct'].includes(route)) {
          $('routingRuleError').textContent = translate('routing.saveFailed');
          return;
        }
        const originalHost = $('routingOriginalHost').value;
        const originalScope = $('routingOriginalScope').value;
        const payload = { host, includeSubdomains: scope === 'subdomains', route };
        if (originalHost && ['exact', 'subdomains'].includes(originalScope)) {
          payload.previous = {
            host: originalHost,
            includeSubdomains: originalScope === 'subdomains',
          };
        }
        setBusy(true);
        try {
          const result = await api.saveRoutingRule(payload);
          if (result?.ok === false) {
            throw new Error(shared.operationError(result, translate('routing.saveFailed')));
          }
          const next = shared.collectionFromResult(result, 'rules');
          if (next) {
            rules = routingRulesForView(next);
            renderList();
          } else {
            await load();
          }
          clearForm({ keepMessages: true });
          $('routingRuleSaved').textContent = translate('routing.saved');
        } catch (error) {
          $('routingRuleError').textContent = error?.message || translate('routing.saveFailed');
        } finally {
          setBusy(false);
        }
      });
      doc.addEventListener('app-locale-changed', () => {
        if (dialog.open) {
          renderList();
          updateFormMode();
        }
      });
      return true;
    }

    return { open, renderList, start };
  }

  let singleton = null;
  function start(options = {}) {
    if (singleton) return singleton;
    singleton = createRoutingManager({
      api: root.api,
      document: root.document,
      i18n: root.I18N,
      ...options,
    });
    singleton.start();
    return singleton;
  }

  return { createRoutingManager, normalizeRoutingHostInput, routingRulesForView, start };
});
