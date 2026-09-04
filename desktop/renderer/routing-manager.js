(function initializeRoutingManager(root, factory) {
  const shared = typeof module !== 'undefined' && module.exports
    ? require('./manager-view') : root.managerView;
  const stackLayout = typeof module !== 'undefined' && module.exports
    ? require('./stacked-card-layout') : root.stackedCardLayout;
  const api = factory(root, shared, stackLayout);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.routingManager = api;
})(typeof self !== 'undefined' ? self : globalThis, function routingManagerFactory(root, shared, stackLayout) {
  'use strict';

  function normalizeRoutingHostInput(value, translate) {
    const source = String(value || '').trim();
    if (!source || source.length > 2048 || /[\u0000-\u0020\u007f*]/u.test(source)) {
      throw new Error(translate('routing.invalidHost'));
    }
    const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(source) ||
      /^(?:data|file|ftp|javascript|mailto):/iu.test(source);
    const candidate = source.startsWith('//') ? `https:${source}`
      : explicitScheme ? source : `https://${source}`;
    let host;
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('unsafe');
      }
      host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    }
    catch { throw new Error(translate('routing.invalidHost')); }
    if (!host || host.length > 253 || host.includes('..') || host.split('.').some((label) => (
      !label || label.length > 63 || !/^[a-z0-9-]+$/u.test(label)
      || label.startsWith('-') || label.endsWith('-')
    ))) throw new Error(translate('routing.invalidHost'));
    return host;
  }

  function routingRulesForView(input) {
    return (Array.isArray(input) ? input : []).filter((rule) => (
      rule && typeof rule.host === 'string' && rule.host.length <= 253
      && typeof rule.includeSubdomains === 'boolean'
      && (rule.route === 'campus' || rule.route === 'direct')
    )).slice(0, 128).map((rule) => ({
      host: rule.host, includeSubdomains: rule.includeSubdomains,
      route: rule.route, updatedAt: rule.updatedAt,
    }));
  }

  function routingGroups(rules, translate) {
    return ['campus', 'direct'].map((route) => ({
      id: route,
      name: translate(route === 'campus' ? 'routing.routeCampus' : 'routing.routeDirect'),
      items: rules.filter((rule) => rule.route === route),
    }));
  }

  function routeStackSlots(width) { return Number(width) >= 440 ? 2 : 1; }

  function createRoutingManager({
    api, document: doc, i18n, openTower = () => {},
    setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
  } = {}) {
    if (!api || !doc || !i18n || typeof openTower !== 'function' ||
        !shared || !stackLayout?.balancedPartitions) {
      throw new TypeError('routing manager dependencies are required');
    }
    const $ = (id) => doc.getElementById(id);
    const dialog = $('routingRulesDialog');
    const translate = (key, vars) => i18n.createT(
      i18n.resolveLocale(doc.documentElement.lang),
    )(key, vars);
    let rules = [];
    let busy = false;
    let preferredRoute = 'campus';
    let routePreferenceChosen = false;
    let pendingDeleteKey = '';
    let pendingDeleteTimer = null;
    let observer = null;
    let started = false;
    let renderedContainer = null;
    let renderSignature = '';
    let previewRevision = 0;
    let previewTimer = null;

    const ruleKey = (rule) => `${rule.host}|${rule.includeSubdomains === true ? '1' : '0'}`;
    const currentRule = () => rules.find((rule) => (
      rule.host === $('routingOriginalHost').value &&
      rule.includeSubdomains === ($('routingOriginalScope').value === 'subdomains')
    )) || null;
    const disarmDelete = () => {
      pendingDeleteKey = '';
      clearTimeoutFn(pendingDeleteTimer);
      pendingDeleteTimer = null;
      $('deleteRoutingRule').textContent = translate('routing.delete');
    };

    function clearPreview() {
      previewRevision += 1;
      clearTimeoutFn(previewTimer);
      previewTimer = null;
      $('routingRulePreview').textContent = '';
      $('routingRulePreview').hidden = true;
    }

    async function previewTarget() {
      const value = $('routingRuleHost').value.trim();
      if (!value) { clearPreview(); return; }
      const revision = ++previewRevision;
      const result = await api.previewRoutingTarget(value).catch(() => null);
      if (revision !== previewRevision) return;
      if (!result?.ok || !result.target) {
        $('routingRulePreview').textContent = translate('routing.previewInvalid');
        $('routingRulePreview').hidden = false;
        return;
      }
      const route = translate(result.resolution?.route === 'direct'
        ? 'routing.routeDirect' : 'routing.routeCampus');
      const source = translate(`routing.source.${result.resolution?.source || 'default'}`);
      $('routingRulePreview').textContent = translate('routing.preview', {
        host: result.target.host, route, source,
      });
      $('routingRulePreview').hidden = false;
    }

    function ruleRows(items) {
      const esc = shared.escapeHtml;
      if (!items.length) return `<p class="category-empty">${esc(translate('routing.emptyGroup'))}</p>`;
      return items.map((rule) => {
        const index = rules.indexOf(rule);
        const scope = rule.includeSubdomains
          ? translate('routing.scopeSubdomains') : translate('routing.scopeExact');
        return `<button class="routing-rule-row" type="button" data-routing-index="${index}"${busy ? ' disabled' : ''}>`
          + `<span class="category-site-icon" aria-hidden="true">${rule.route === 'direct' ? '⇄' : '◇'}</span>`
          + `<span class="category-site-copy"><strong>${esc(rule.host)}</strong><small>${esc(scope)}</small></span>`
          + `<span class="routing-rule-edit">${esc(translate('routing.edit'))}</span></button>`;
      }).join('');
    }

    function renderStack(stack, index) {
      const esc = shared.escapeHtml;
      const active = stack.find(({ id }) => id === preferredRoute) || stack[0];
      const panelId = `routing-stack-panel-${index}`;
      const headingId = `routing-stack-heading-${index}`;
      const tabs = stack.filter(({ id }) => id !== active.id).map((group) => (
        `<button class="stacked-category-tab" type="button" data-routing-stack-activate="${group.id}" aria-controls="${panelId}">`
        + `<span>${esc(group.name)}</span><small>${group.items.length}</small></button>`
      )).join('');
      return `<section class="category-stack${stack.length > 1 ? ' layered' : ''}" data-routing-stack-index="${index}" role="group" aria-labelledby="${headingId}">`
        + `<div class="category-stack-tabs">${tabs}</div>`
        + `<article id="${panelId}" class="category-card routing-rule-card" data-routing-group="${active.id}" role="region" aria-labelledby="${headingId}">`
        + `<header><h3 id="${headingId}" tabindex="-1" data-routing-heading="${active.id}">${esc(active.name)}</h3><span>${active.items.length}</span></header>`
        + `<div class="routing-rule-stack-list">${ruleRows(active.items)}</div></article></section>`;
    }

    function focusRoutingHeading(container, routeId) {
      if (!routeId) return false;
      const heading = [...container.querySelectorAll('[data-routing-heading]')]
        .find((candidate) => candidate.dataset.routingHeading === routeId);
      if (!heading) return false;
      heading.focus({ preventScroll: true });
      return true;
    }

    function renderStacks({ focusRouteId = null } = {}) {
      const container = $('routingRuleStacks');
      const groups = routingGroups(rules, translate);
      const slots = routeStackSlots(container.getBoundingClientRect().width);
      const markup = stackLayout.balancedPartitions(groups, slots)
        .map(renderStack).join('');
      const nextSignature = `${slots}\u0000${busy ? 'busy' : 'ready'}\u0000${markup}`;
      container.style.setProperty('--stack-columns', String(slots));
      container.dataset.stackColumns = String(slots);
      container.setAttribute('aria-busy', String(busy));
      const changed = renderedContainer !== container || renderSignature !== nextSignature;
      if (changed) {
        container.innerHTML = markup;
        renderedContainer = container;
        renderSignature = nextSignature;
      }
      if (focusRouteId) focusRoutingHeading(container, focusRouteId);
      return changed;
    }

    function updateFormMode() {
      const host = $('routingOriginalHost').value;
      const editing = !!host;
      $('saveRoutingRule').textContent = editing ? translate('routing.save') : translate('routing.add');
      $('cancelRoutingRule').textContent = editing ? translate('routing.cancelEdit') : translate('routing.clear');
      $('routingRuleEditHint').textContent = editing ? translate('routing.editing', { host }) : '';
      $('deleteRoutingRule').hidden = !editing;
      if (!editing) disarmDelete();
    }

    function clearForm({ keepMessages = false } = {}) {
      $('routingOriginalHost').value = '';
      $('routingOriginalScope').value = '';
      $('routingRuleHost').value = '';
      $('routingRuleScope').value = 'exact';
      $('routingRuleRoute').value = preferredRoute;
      if (!keepMessages) {
        $('routingRuleError').textContent = '';
        $('routingRuleSaved').textContent = '';
      }
      updateFormMode();
    }

    function editRule(rule) {
      disarmDelete();
      $('routingOriginalHost').value = rule.host;
      $('routingOriginalScope').value = rule.includeSubdomains ? 'subdomains' : 'exact';
      $('routingRuleHost').value = rule.host;
      $('routingRuleScope').value = rule.includeSubdomains ? 'subdomains' : 'exact';
      $('routingRuleRoute').value = rule.route;
      $('routingRuleError').textContent = '';
      $('routingRuleSaved').textContent = '';
      clearPreview();
      updateFormMode();
      if (!dialog.open) dialog.showModal();
      $('routingRuleHost').focus();
    }

    function setBusy(nextBusy) {
      busy = nextBusy === true;
      $('routingRuleForm').setAttribute('aria-busy', String(busy));
      $('routingRuleForm').querySelectorAll('input, select, button').forEach((control) => {
        control.disabled = busy;
      });
      $('manageRoutingRules').disabled = busy;
      renderStacks();
    }

    async function load() {
      $('routingRuleStackStatus').textContent = translate('routing.loading');
      try {
        const result = await api.listRoutingRules();
        if (result?.ok === false) throw new Error(shared.operationError(result, translate('routing.loadFailed')));
        const next = shared.collectionFromResult(result, 'rules');
        if (!next) throw new Error(translate('routing.loadFailed'));
        rules = routingRulesForView(next);
        if (!routePreferenceChosen && !rules.some((rule) => rule.route === preferredRoute)) {
          preferredRoute = rules.some((rule) => rule.route === 'direct') ? 'direct' : 'campus';
        }
        $('routingRuleStackStatus').textContent = '';
        renderStacks();
        return true;
      } catch (error) {
        rules = [];
        renderStacks();
        $('routingRuleStackStatus').textContent = error?.message || translate('routing.loadFailed');
        return false;
      }
    }

    function openNew(route = preferredRoute) {
      if (busy) return;
      preferredRoute = route === 'direct' ? 'direct' : 'campus';
      routePreferenceChosen = true;
      clearForm();
      if (!dialog.open) dialog.showModal();
      $('routingRuleHost').focus();
    }

    async function deleteCurrentRule() {
      const rule = currentRule();
      if (!rule || busy) return;
      if (pendingDeleteKey !== ruleKey(rule)) {
        pendingDeleteKey = ruleKey(rule);
        $('deleteRoutingRule').textContent = translate('routing.confirmDelete');
        clearTimeoutFn(pendingDeleteTimer);
        pendingDeleteTimer = setTimeoutFn(disarmDelete, 4000);
        return;
      }
      disarmDelete();
      setBusy(true);
      $('routingRuleError').textContent = '';
      $('routingRuleSaved').textContent = '';
      void previewTarget();
      try {
        const result = await api.deleteRoutingRule({
          host: rule.host, includeSubdomains: rule.includeSubdomains,
        });
        if (result?.ok === false) throw new Error(shared.operationError(result, translate('routing.deleteFailed')));
        const next = shared.collectionFromResult(result, 'rules');
        if (next) rules = routingRulesForView(next); else await load();
        clearForm({ keepMessages: true });
        $('routingRuleSaved').textContent = translate('routing.deleted');
        renderStacks();
      } catch (error) {
        $('routingRuleError').textContent = error?.message || translate('routing.deleteFailed');
      } finally { setBusy(false); }
    }

    async function saveRule(event) {
      event.preventDefault();
      if (busy) return;
      $('routingRuleError').textContent = '';
      $('routingRuleSaved').textContent = '';
      let host;
      try { host = normalizeRoutingHostInput($('routingRuleHost').value, translate); }
      catch (error) {
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
      const payload = { target: $('routingRuleHost').value,
        includeSubdomains: scope === 'subdomains', route };
      if ($('routingOriginalHost').value && ['exact', 'subdomains'].includes($('routingOriginalScope').value)) {
        payload.previous = { host: $('routingOriginalHost').value,
          includeSubdomains: $('routingOriginalScope').value === 'subdomains' };
      }
      setBusy(true);
      try {
        const result = await api.saveRoutingRule(payload);
        if (result?.ok === false) throw new Error(shared.operationError(result, translate('routing.saveFailed')));
        const next = shared.collectionFromResult(result, 'rules');
        if (next) rules = routingRulesForView(next); else await load();
        preferredRoute = route;
        routePreferenceChosen = true;
        clearForm({ keepMessages: true });
        $('routingRuleSaved').textContent = translate('routing.saved');
        renderStacks();
      } catch (error) {
        $('routingRuleError').textContent = error?.message || translate('routing.saveFailed');
      } finally { setBusy(false); }
    }

    function start() {
      if (started) return false;
      started = true;
      $('manageRoutingRules').addEventListener('click', () => openNew());
      $('closeRoutingRulesDialog').addEventListener('click', () => dialog.close());
      $('cancelRoutingRule').addEventListener('click', () => clearForm());
      $('deleteRoutingRule').addEventListener('click', deleteCurrentRule);
      $('routingRuleForm').addEventListener('submit', saveRule);
      $('routingRuleHost').addEventListener('input', () => {
        clearTimeoutFn(previewTimer);
        previewTimer = setTimeoutFn(() => { previewTimer = null; void previewTarget(); }, 180);
      });
      $('routingRuleHost').addEventListener('blur', () => { void previewTarget(); });
      dialog.addEventListener('close', () => { disarmDelete(); clearForm(); });
      $('routingRuleStacks').addEventListener('click', (event) => {
        const tab = event.target.closest('[data-routing-stack-activate]');
        if (tab) {
          preferredRoute = tab.dataset.routingStackActivate;
          routePreferenceChosen = true;
          $('routingRuleStacks').classList.add('reordering');
          renderStacks({ focusRouteId: preferredRoute });
          root.setTimeout(() => $('routingRuleStacks').classList.remove('reordering'), 280);
          return;
        }
        const row = event.target.closest('[data-routing-index]');
        const rule = row ? rules[Number(row.dataset.routingIndex)] : null;
        if (rule && !busy) editRule(rule);
      });
      api.onOpenRoutingRules?.(() => {
        openTower();
        load().finally(() => root.requestAnimationFrame?.(() => (
          $('towerRoutingSection').scrollIntoView({ behavior: 'smooth', block: 'start' })
        )));
      });
      doc.addEventListener('app-locale-changed', () => {
        renderStacks();
        if (dialog.open) updateFormMode();
      });
      if (typeof root.ResizeObserver === 'function') {
        observer = new root.ResizeObserver(renderStacks);
        observer.observe($('routingRuleStacks'));
      }
      renderStacks();
      load();
      return true;
    }

    return { load, open: openNew, renderStacks, start };
  }

  let singleton = null;
  function start(options = {}) {
    if (singleton) return singleton;
    singleton = createRoutingManager({ api: root.api, document: root.document,
      i18n: root.I18N, ...options });
    singleton.start();
    return singleton;
  }

  return { createRoutingManager, normalizeRoutingHostInput, routeStackSlots,
    routingGroups, routingRulesForView, start };
});
