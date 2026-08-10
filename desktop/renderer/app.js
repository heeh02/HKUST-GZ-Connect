'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Active UI language. Chinese until get-state reports the real system locale.
let t = window.I18N.createT('zh');
let st = {
  connected: false,
  connecting: false,
  clientIp: null,
  dnsMode: 'unknown',
  lastError: null,
};
let settings = {};
let connectedAt = null;
let durTimer = null;
let pacUrl = '';
let campusActionBusy = false;
let campusResources = [];
let resourcesExpanded = false;
let towerDirty = false;
let towerSaving = false;
let proxyAuthSaving = false;
let loginPending = false;
const resourceDialog = $('resourceDialog');
const routingRulesDialog = $('routingRulesDialog');
const certificatePinsDialog = $('certificatePinsDialog');
let routingRules = [];
let routingRuleBusy = false;
let pendingRoutingDeleteKey = '';
let pendingRoutingDeleteTimer = null;
let certificatePins = [];
let certificatePinBusy = false;
let pendingCertificateOrigin = '';
let pendingCertificateDeleteTimer = null;

function show(view) { $('login').hidden = view !== 'login'; $('dash').hidden = view !== 'dash'; }

function applyLocale(rawLocale) {
  const locale = window.I18N.resolveLocale(rawLocale);
  t = window.I18N.createT(locale);
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  window.I18N.applyStatic(t, document);
  // Labels whose text depends on runtime state, not just the locale.
  document.querySelectorAll('[data-toggle-section]').forEach((button) => {
    const panel = document.querySelector(`[data-collapsible="${button.dataset.toggleSection}"]`);
    const expanded = panel ? !panel.hidden : false;
    button.textContent = expanded ? t('section.collapse') : t('section.expand');
    button.setAttribute('aria-expanded', String(expanded));
  });
  if (routingRulesDialog.open) {
    renderRoutingRuleList();
    updateRoutingRuleFormMode();
  }
  if (certificatePinsDialog.open) renderCertificatePinList();
}
function setPage(page) {
  document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  document.querySelectorAll('.page').forEach((p) => { const on = p.dataset.page === page; p.classList.toggle('active', on); p.hidden = !on; });
  if (page === 'notif') loadLogs();
  if (page === 'settings') runUpdateCheck(false);
}
function fmtDur(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }
function startDur() { stopDur(); durTimer = setInterval(() => { if (connectedAt) $('stDur').textContent = fmtDur(Date.now() - connectedAt); }, 1000); }
function stopDur() { if (durTimer) clearInterval(durTimer); durTimer = null; }

function evaluateLoginProgress(pending, state = {}) {
  if (!pending) return { pending: false, view: null, clearPassword: false, error: '' };
  if (state.connected) return { pending: false, view: 'dash', clearPassword: true, error: '' };
  if (!state.connecting && state.lastError) {
    return { pending: false, view: 'login', clearPassword: false, error: String(state.lastError) };
  }
  return { pending: true, view: 'login', clearPassword: false, error: t('login.connecting') };
}

function visibleResources(resources, expanded, limit = 4) {
  const items = Array.isArray(resources) ? resources : [];
  return expanded ? items : items.slice(0, Math.max(0, limit));
}

function routeLabel(resource) {
  return resource?.route === 'direct' ? t('resources.routeDirect') : t('resources.routeCampus');
}

function dnsModeLabel(mode) {
  if (mode === 'gateway') return t('stats.dnsGateway');
  if (mode === 'system_fallback') return t('stats.dnsFallback');
  if (mode === 'disabled') return t('stats.dnsDisabled');
  return t('stats.dnsUnknown');
}

function updateLoginProgress(s) {
  if (!loginPending) return;
  const next = evaluateLoginProgress(loginPending, s);
  $('lgBtn').disabled = next.pending;
  $('lgBtn').textContent = next.pending ? t('connect.connecting') : t('login.submit');
  $('lgErr').textContent = next.error;
  if (next.pending) return;
  loginPending = false;
  if (next.clearPassword) $('lgPass').value = '';
  show(next.view);
  if (next.view === 'dash') setPage('connect');
}

function renderConnect(s) {
  // Status pushes carry the effective locale so a language switch re-renders
  // live; locally constructed state has no locale and keeps the current one.
  if (typeof s.locale === 'string') applyLocale(s.locale);
  st = s;
  connectedAt = s.connected ? (s.connectedAt || connectedAt) : null;
  $('power').classList.toggle('on', s.connected);
  $('power').classList.toggle('busy', s.connecting);
  const wrap = document.querySelector('.conn-status');
  wrap.classList.toggle('on', s.connected); wrap.classList.toggle('busy', s.connecting);
  $('connStatus').textContent = s.connecting
    ? t('connect.connecting')
    : s.connected ? t('connect.connected') : t('connect.disconnected');
  $('connIp').textContent = s.connected && s.clientIp ? s.clientIp : '—';
  $('connTop').classList.toggle('connected', s.connected);
  $('connErr').textContent = (!s.connected && !s.connecting && s.lastError) ? s.lastError : '';
  $('settingsNotice').hidden = !s.notice;
  $('settingsNotice').textContent = s.notice || '';
  $('quickCampus').disabled = campusActionBusy;
  $('quickAddCampus').disabled = campusActionBusy;
  $('quickCampus').textContent = campusActionBusy
    ? (s.connected ? t('quick.opening') : t('quick.connectThenOpen'))
    : (s.connected ? t('quick.open') : t('quick.connectOpen'));
  $('statGrid').hidden = !s.connected;
  $('appsCard').hidden = !s.connected;
  $('stIp').textContent = s.clientIp || '—';
  $('stDns').textContent = dnsModeLabel(s.dnsMode);
  if (s.connected && connectedAt) { startDur(); $('stDur').textContent = fmtDur(Date.now() - connectedAt); }
  else { stopDur(); $('stDur').textContent = '0:00'; $('stPing').textContent = '—'; $('stConn').textContent = '0'; $('appList').innerHTML = ''; }
  updateLoginProgress(s);
}

function renderTelemetry(tele) {
  if (tele.connectedAt) connectedAt = tele.connectedAt;
  $('stPing').textContent = (tele.latencyMs != null) ? Math.round(tele.latencyMs) + ' ms' : '—';
  $('stConn').textContent = tele.connCount || 0;
  const list = $('appList');
  if (!tele.apps || !tele.apps.length) { list.innerHTML = `<div class="app-empty">${esc(t('stats.appsEmpty'))}</div>`; return; }
  list.innerHTML = tele.apps.map((a) =>
    `<div class="app-row"><span class="app-dot"></span><span class="app-name">${esc(a.name)}</span><span class="app-meta">${esc(t('stats.connectionCount', { count: a.count }))}</span></div>`).join('');
}

function renderResources() {
  const visible = visibleResources(campusResources, resourcesExpanded);
  $('campusResources').innerHTML = visible.map((resource) =>
    `<button class="resource-link" data-campus-id="${esc(resource.id)}" title="${esc(resource.url)}">`
    + `<span class="resource-name">${esc(resource.name)}</span>`
    + `<span class="resource-desc">${esc(resource.description || resource.url)}</span>`
    + `<span class="resource-route ${resource.route === 'direct' ? 'direct' : 'campus'}">${esc(routeLabel(resource))}</span></button>`).join('');
  const toggle = $('toggleResources');
  const hasMore = campusResources.length > 4;
  toggle.hidden = !hasMore;
  toggle.textContent = resourcesExpanded ? t('resources.collapse') : t('resources.expandAll');
  toggle.setAttribute('aria-expanded', String(resourcesExpanded));
}

function suggestedResourceName(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(source) ? source : `https://${source}`;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.host : '';
  } catch {
    return '';
  }
}

function setResourceSaved(message) {
  $('resourceSaved').textContent = message || '';
}

function clearResourceMessages() {
  $('resourceFormError').textContent = '';
  $('resourceFormSaved').textContent = '';
}

async function saveCampusResource(payload) {
  const result = await window.api.saveResource(payload);
  if (!result?.ok) return { ok: false, error: result?.error || t('dialog.saveFailed') };
  campusResources = result.resources || campusResources;
  renderResources();
  renderResourceEditorList();
  return { ok: true, resource: result.resource };
}

function populateTowerForm() {
  $('towerPort').value = settings.port || 1080;
  $('routeDomains').value = (settings.routeDomains || []).join('\n');
  $('strictProxyAuth').checked = settings.strictProxyAuth === true;
  $('autoReconnect').checked = settings.autoReconnect !== false;
  $('maxAttempts').value = settings.maxAttempts ?? 3;
  $('startAtLogin').checked = !!settings.startAtLogin;
  $('autoConnect').checked = settings.autoConnect !== false;
}

async function refreshState({ preserveTower = false } = {}) {
  const s = await window.api.getState();
  applyLocale(s.locale);
  settings = s.settings || {}; pacUrl = s.pacUrl || '';
  campusResources = Array.isArray(s.campusResources) ? s.campusResources : [];
  renderConnect(s);
  renderResources();
  $('socksEndpoint').textContent = '127.0.0.1:' + (Number(settings.port) || 1080);
  if (!preserveTower || !towerDirty) populateTowerForm();
  $('acct').textContent = settings.username || '—';
  $('ver').textContent = s.version ? `v${s.version}` : '—';
  if (s.update) renderUpdateResult(s.update);
  $('closeAction').value = ['ask', 'minimize', 'quit'].includes(settings.closeAction) ? settings.closeAction : 'ask';
  $('language').value = ['auto', 'zh', 'en'].includes(settings.language) ? settings.language : 'auto';
  return s;
}

// update check (notify only — the app never downloads updates itself)
let updateHintTimer = null;
let updateDownloadUrl = '';
function setUpdateHint(html, { sticky = false } = {}) {
  const el = $('updateHint');
  if (updateHintTimer) { clearTimeout(updateHintTimer); updateHintTimer = null; }
  el.innerHTML = html || '';
  el.hidden = !html;
  if (html && !sticky) updateHintTimer = setTimeout(() => { el.hidden = true; }, 3500);
}
$('updateHint').addEventListener('click', (event) => {
  if (!event.target?.closest?.('#updateDownload') || !updateDownloadUrl) return;
  window.api.openExternal(updateDownloadUrl);
});
function renderUpdateResult(result, { manual = false } = {}) {
  if (result && result.updateAvailable) {
    updateDownloadUrl = String(result.url || '');
    setUpdateHint(
      t('settings.updateAvailable', {
        version: esc(result.latestVersion),
        button: t('settings.updateDownload'),
      }),
      { sticky: true },
    );
  } else if (manual) {
    updateDownloadUrl = '';
    setUpdateHint(result ? t('settings.updateLatest') : t('settings.updateFailed'));
  }
}
async function runUpdateCheck(manual) {
  try {
    renderUpdateResult(await window.api.checkUpdate(manual === true), { manual });
  } catch {
    if (manual) setUpdateHint(t('settings.updateFailed'));
  }
}

async function loadLogs() {
  const text = await window.api.getLogs();
  const box = $('logs');
  box.textContent = text && text.trim() ? text : t('notif.empty');
  box.scrollTop = box.scrollHeight;
}

async function init() {
  const s = await refreshState();
  $('lgUser').value = settings.username || '';
  show(s.loggedIn ? 'dash' : 'login');
}

// login
$('lgBtn').addEventListener('click', async () => {
  if (loginPending) return;
  const u = $('lgUser').value.trim(), p = $('lgPass').value;
  if (!u) { $('lgErr').textContent = t('login.needAccount'); return; }
  if (!p) { $('lgErr').textContent = t('login.needPassword'); return; }
  let saved;
  try {
    saved = await window.api.save({ username: u, password: p });
  } catch (error) {
    $('lgErr').textContent = error?.message || t('login.passwordSaveFailed');
    return;
  }
  if (!saved.ok) { $('lgErr').textContent = saved.error || t('login.passwordSaveFailed'); return; }
  loginPending = true;
  $('lgBtn').disabled = true;
  $('lgBtn').textContent = t('connect.connecting');
  $('lgErr').textContent = t('login.connecting');
  try {
    await window.api.connect();
    await refreshState();
  } catch (error) {
    loginPending = false;
    $('lgBtn').disabled = false;
    $('lgBtn').textContent = t('login.submit');
    $('lgErr').textContent = error?.message || t('login.connectFailed');
  }
});
$('lgPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lgBtn').click(); });

// nav + power
document.querySelectorAll('.nav').forEach((n) => n.addEventListener('click', () => setPage(n.dataset.page)));
$('power').addEventListener('click', async () => {
  if (st.connecting) return;
  if (st.connected) await window.api.disconnect(); else await window.api.connect();
});

document.querySelectorAll('[data-toggle-section]').forEach((button) => {
  button.addEventListener('click', () => {
    const key = button.dataset.toggleSection;
    const panel = document.querySelector(`[data-collapsible="${key}"]`);
    if (!panel) return;
    const expanded = panel.hidden;
    panel.hidden = !expanded;
    button.textContent = expanded ? t('section.collapse') : t('section.expand');
    button.setAttribute('aria-expanded', String(expanded));
  });
});

async function openCampus(selected) {
  if (campusActionBusy) return;
  campusActionBusy = true;
  $('quickErr').textContent = '';
  renderConnect(st);
  try {
    const request = selected && typeof selected === 'object'
      ? { url: selected.url, route: selected.route }
      : { url: typeof selected === 'string' ? selected : $('campusUrl').value };
    const result = await window.api.openCampusBrowser(request);
    if (!result || !result.ok) $('quickErr').textContent = result?.error || t('quick.browserOpenFailed');
  } finally {
    campusActionBusy = false;
    renderConnect(st);
  }
}
$('quickCampus').addEventListener('click', openCampus);
$('quickAddCampus').addEventListener('click', async () => {
  if (campusActionBusy) return;
  const url = $('campusUrl').value.trim();
  $('quickAddErr').textContent = '';
  setResourceSaved('');
  if (!url) {
    $('quickAddErr').textContent = t('quick.needUrl');
    $('campusUrl').focus();
    return;
  }

  campusActionBusy = true;
  renderConnect(st);
  try {
    const name = suggestedResourceName(url);
    const saved = await saveCampusResource({ name, url, description: '' });
    if (!saved.ok) {
      $('quickAddErr').textContent = saved.error;
      return;
    }
    setResourceSaved(t('resources.saved'));
    const result = await window.api.openCampusBrowser({
      url: saved.resource.url,
      route: saved.resource.route,
    });
    if (!result?.ok) $('quickAddErr').textContent = result?.error || t('quick.browserOpenFailed');
  } catch (error) {
    $('quickAddErr').textContent = error?.message || t('quick.addFailed');
  } finally {
    campusActionBusy = false;
    renderConnect(st);
  }
});
$('campusResources').addEventListener('click', (event) => {
  const target = event.target.closest('[data-campus-id]');
  const resource = campusResources.find((item) => item.id === target?.dataset.campusId);
  if (resource) openCampus(resource);
});
$('campusUrl').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') openCampus();
});

$('toggleResources').addEventListener('click', () => {
  resourcesExpanded = !resourcesExpanded;
  renderResources();
});

function clearResourceEditor() {
  disarmDeleteConfirm();
  $('resourceId').value = '';
  $('resourceName').value = '';
  $('resourceUrl').value = '';
  $('resourceDescription').value = '';
  $('resourceRoute').value = 'campus';
  clearResourceMessages();
  setResourceFormMode(null);
  document.querySelectorAll('.resource-editor-row').forEach((row) => row.classList.remove('active'));
}

function setResourceFormMode(editingResource) {
  const editing = !!editingResource;
  $('saveResource').textContent = editing ? t('dialog.saveChanges') : t('dialog.add');
  $('cancelResource').textContent = editing ? t('dialog.cancelEdit') : t('dialog.clear');
  $('resourceEditHint').textContent = editing
    ? t('dialog.editing', { name: editingResource.name || editingResource.url })
    : '';
}

function fillResourceEditor(resource) {
  disarmDeleteConfirm();
  $('resourceId').value = resource?.builtin ? '' : (resource?.id || '');
  $('resourceName').value = resource?.name || '';
  $('resourceUrl').value = resource?.url || '';
  $('resourceDescription').value = resource?.description || '';
  $('resourceRoute').value = resource?.route === 'direct' ? 'direct' : 'campus';
  clearResourceMessages();
  setResourceFormMode(resource && !resource.builtin ? resource : null);
  $('resourceFormError').textContent = resource?.builtin ? t('dialog.builtinReadonly') : '';
  document.querySelectorAll('.resource-editor-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.resourceId === resource?.id);
  });
}

const RESOURCE_ICONS = {
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  delete: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  'cancel-delete': '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

function resourceActionButton(action, label, disabled = false) {
  return `<button class="row-icon${action === 'delete' ? ' danger' : ''}" type="button"`
    + ` data-resource-action="${action}" title="${esc(label)}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}>`
    + `${RESOURCE_ICONS[action]}</button>`;
}

let pendingDeleteId = null;
let pendingDeleteTimer = null;

function disarmDeleteConfirm() {
  pendingDeleteId = null;
  clearTimeout(pendingDeleteTimer);
  pendingDeleteTimer = null;
}

function armDeleteConfirm(id) {
  pendingDeleteId = id;
  clearTimeout(pendingDeleteTimer);
  pendingDeleteTimer = setTimeout(() => {
    disarmDeleteConfirm();
    renderResourceEditorList();
  }, 4000);
  renderResourceEditorList();
}

function renderResourceEditorList() {
  const customIds = campusResources.filter((item) => !item.builtin).map((item) => item.id);
  $('resourceEditorList').innerHTML = campusResources.map((resource) => {
    const custom = !resource.builtin;
    let actions;
    if (!custom) {
      actions = `<span class="resource-editor-route">${esc(t('dialog.builtin'))}</span>`;
    } else if (pendingDeleteId === resource.id) {
      actions = `<button class="row-icon confirm-delete" type="button" data-resource-action="delete">${esc(t('dialog.confirmDelete'))}</button>`
        + resourceActionButton('cancel-delete', t('dialog.cancelDelete'));
    } else {
      const index = customIds.indexOf(resource.id);
      actions = resourceActionButton('edit', t('dialog.edit'))
        + resourceActionButton('up', t('dialog.moveUp'), index <= 0)
        + resourceActionButton('down', t('dialog.moveDown'), index === customIds.length - 1)
        + resourceActionButton('delete', t('dialog.delete'));
    }
    return `<div class="resource-editor-row" data-resource-id="${esc(resource.id)}">`
      + `<div class="resource-editor-summary"><span class="resource-editor-name">${esc(resource.name)}</span>`
      + `<span class="resource-editor-route">${esc(routeLabel(resource))}</span></div>`
      + `<div class="resource-editor-actions">${actions}</div>`
      + `</div>`;
  }).join('');
}

async function openResourceManager() {
  renderResourceEditorList();
  clearResourceEditor();
  if (!resourceDialog.open) resourceDialog.showModal();
}

$('manageResources').addEventListener('click', openResourceManager);
$('closeResourceDialog').addEventListener('click', () => resourceDialog.close());
$('cancelResource').addEventListener('click', clearResourceEditor);
$('resourceUrl').addEventListener('blur', () => {
  if ($('resourceName').value.trim()) return;
  const suggestion = suggestedResourceName($('resourceUrl').value);
  if (suggestion) $('resourceName').value = suggestion;
});
$('resourceEditorList').addEventListener('click', async (event) => {
  const row = event.target.closest('[data-resource-id]');
  if (!row) return;
  const resource = campusResources.find((item) => item.id === row.dataset.resourceId);
  const action = event.target.closest('[data-resource-action]')?.dataset.resourceAction;
  if (!resource || resource.builtin) return;
  if (action === 'cancel-delete') {
    disarmDeleteConfirm();
    renderResourceEditorList();
    return;
  }
  if (action === 'delete') {
    if (pendingDeleteId !== resource.id) {
      armDeleteConfirm(resource.id);
      return;
    }
    disarmDeleteConfirm();
    const result = await window.api.deleteResource(resource.id);
    if (!result?.ok) { $('resourceFormError').textContent = result?.error || t('dialog.deleteFailed'); return; }
    campusResources = result.resources || campusResources.filter((item) => item.id !== resource.id);
    renderResources();
    renderResourceEditorList();
    clearResourceEditor();
    return;
  }
  disarmDeleteConfirm();
  if (action === 'edit') fillResourceEditor(resource);
  if (action === 'up' || action === 'down') {
    const localIds = campusResources.filter((item) => !item.builtin).map((item) => item.id);
    const index = localIds.indexOf(resource.id);
    const target = action === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= localIds.length) return;
    [localIds[index], localIds[target]] = [localIds[target], localIds[index]];
    const result = await window.api.reorderResources(localIds);
    if (result?.ok) {
      campusResources = result.resources || campusResources;
      renderResources();
      renderResourceEditorList();
    }
  }
});
$('resourceForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearResourceMessages();
  if (!$('resourceName').value.trim()) $('resourceName').value = suggestedResourceName($('resourceUrl').value);
  const editing = !!$('resourceId').value;
  try {
    const saved = await saveCampusResource({
      id: $('resourceId').value || undefined,
      name: $('resourceName').value,
      url: $('resourceUrl').value,
      description: $('resourceDescription').value,
      route: $('resourceRoute').value,
    });
    if (!saved.ok) { $('resourceFormError').textContent = saved.error; return; }
    clearResourceEditor();
    const message = editing ? t('resources.changesSaved') : t('resources.saved');
    $('resourceFormSaved').textContent = message;
    setResourceSaved(message);
  } catch (error) {
    $('resourceFormError').textContent = error?.message || t('dialog.saveFailed');
  }
});

// Website route rules -------------------------------------------------------
// The renderer treats main-process results as untrusted structured input. The
// main process remains the authoritative validator and persistence boundary.
function collectionFromResult(result, key) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.[key]) ? result[key] : null;
}

function operationError(result, fallback) {
  const message = typeof result?.error === 'string' ? result.error.trim() : '';
  return message ? message.slice(0, 300) : fallback;
}

function formatManagerTime(value) {
  const numeric = value === null || value === undefined || value === '' ? Number.NaN : Number(value);
  const instant = Number.isFinite(numeric) ? new Date(numeric) : new Date(String(value || ''));
  if (!Number.isFinite(instant.getTime())) return t('common.unknownTime');
  try {
    return new Intl.DateTimeFormat(document.documentElement.lang || 'zh-CN', {
      dateStyle: 'medium', timeStyle: 'short',
    }).format(instant);
  } catch {
    return instant.toLocaleString();
  }
}

function normalizeRoutingHostInput(value) {
  const source = String(value || '').trim();
  if (!source || source.length > 254 || /[\u0000-\u0020\u007f:/@*?#\\]/u.test(source)
      || source.startsWith('.') || source.endsWith('..')) {
    throw new Error(t('routing.invalidHost'));
  }
  const withoutRootDot = source.endsWith('.') ? source.slice(0, -1) : source;
  let host;
  try {
    host = new URL(`https://${withoutRootDot}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    throw new Error(t('routing.invalidHost'));
  }
  if (!host || host.length > 253 || host.includes('..') || host.split('.').some((label) => (
    !label || label.length > 63 || !/^[a-z0-9-]+$/u.test(label)
    || label.startsWith('-') || label.endsWith('-')
  ))) {
    throw new Error(t('routing.invalidHost'));
  }
  return host;
}

function routingRuleKey(rule) {
  return `${rule.host}|${rule.includeSubdomains === true ? '1' : '0'}`;
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

function disarmRoutingDelete() {
  pendingRoutingDeleteKey = '';
  clearTimeout(pendingRoutingDeleteTimer);
  pendingRoutingDeleteTimer = null;
}

function armRoutingDelete(rule) {
  pendingRoutingDeleteKey = routingRuleKey(rule);
  clearTimeout(pendingRoutingDeleteTimer);
  pendingRoutingDeleteTimer = setTimeout(() => {
    disarmRoutingDelete();
    renderRoutingRuleList();
  }, 4000);
  renderRoutingRuleList();
}

function renderRoutingRuleList() {
  $('routingRuleList').innerHTML = routingRules.map((rule, index) => {
    const pending = pendingRoutingDeleteKey === routingRuleKey(rule);
    const disabled = routingRuleBusy ? ' disabled' : '';
    const actions = pending
      ? `<button class="mini confirm-action" type="button" data-routing-action="delete" data-routing-index="${index}"${disabled}>${esc(t('routing.confirmDelete'))}</button>`
        + `<button class="mini" type="button" data-routing-action="cancel-delete" data-routing-index="${index}"${disabled}>${esc(t('routing.cancelDelete'))}</button>`
      : `<button class="mini" type="button" data-routing-action="edit" data-routing-index="${index}"${disabled}>${esc(t('routing.edit'))}</button>`
        + `<button class="mini danger-action" type="button" data-routing-action="delete" data-routing-index="${index}"${disabled}>${esc(t('routing.delete'))}</button>`;
    return `<div class="manager-item routing-rule-item" role="listitem">`
      + `<div class="manager-item-main"><div class="manager-item-title">${esc(rule.host)}</div>`
      + `<div class="manager-item-details"><span class="manager-chip">${esc(rule.includeSubdomains ? t('routing.scopeSubdomains') : t('routing.scopeExact'))}</span>`
      + `<span class="manager-chip ${rule.route}">${esc(rule.route === 'direct' ? t('routing.routeDirect') : t('routing.routeCampus'))}</span>`
      + `<span class="manager-time">${esc(t('routing.updated', { time: formatManagerTime(rule.updatedAt) }))}</span></div></div>`
      + `<div class="manager-item-actions">${actions}</div></div>`;
  }).join('');
  $('routingRuleListStatus').textContent = routingRules.length ? '' : t('routing.empty');
}

function updateRoutingRuleFormMode() {
  const host = $('routingOriginalHost').value;
  const editing = !!host;
  $('saveRoutingRule').textContent = editing ? t('routing.save') : t('routing.add');
  $('cancelRoutingRule').textContent = editing ? t('routing.cancelEdit') : t('routing.clear');
  $('routingRuleEditHint').textContent = editing ? t('routing.editing', { host }) : '';
}

function clearRoutingRuleForm({ keepMessages = false } = {}) {
  $('routingOriginalHost').value = '';
  $('routingOriginalScope').value = '';
  $('routingRuleHost').value = '';
  $('routingRuleScope').value = 'exact';
  $('routingRuleRoute').value = 'campus';
  if (!keepMessages) {
    $('routingRuleError').textContent = '';
    $('routingRuleSaved').textContent = '';
  }
  updateRoutingRuleFormMode();
  document.querySelectorAll('.routing-rule-item').forEach((row) => row.classList.remove('active'));
}

function editRoutingRule(rule, index) {
  disarmRoutingDelete();
  $('routingOriginalHost').value = rule.host;
  $('routingOriginalScope').value = rule.includeSubdomains ? 'subdomains' : 'exact';
  $('routingRuleHost').value = rule.host;
  $('routingRuleScope').value = rule.includeSubdomains ? 'subdomains' : 'exact';
  $('routingRuleRoute').value = rule.route;
  $('routingRuleError').textContent = '';
  $('routingRuleSaved').textContent = '';
  updateRoutingRuleFormMode();
  document.querySelectorAll('.routing-rule-item').forEach((row, rowIndex) => {
    row.classList.toggle('active', rowIndex === index);
  });
  $('routingRuleHost').focus();
}

function setRoutingRuleBusy(busy) {
  routingRuleBusy = busy;
  $('routingRuleForm').setAttribute('aria-busy', String(busy));
  $('routingRuleForm').querySelectorAll('input, select, button').forEach((control) => {
    control.disabled = busy;
  });
  renderRoutingRuleList();
}

async function loadRoutingRules() {
  $('routingRuleList').innerHTML = '';
  $('routingRuleListStatus').textContent = t('routing.loading');
  $('routingRuleError').textContent = '';
  try {
    const result = await window.api.listRoutingRules();
    if (result?.ok === false) throw new Error(operationError(result, t('routing.loadFailed')));
    const rules = collectionFromResult(result, 'rules');
    if (!rules) throw new Error(t('routing.loadFailed'));
    routingRules = routingRulesForView(rules);
    renderRoutingRuleList();
    return true;
  } catch (error) {
    routingRules = [];
    $('routingRuleList').innerHTML = '';
    $('routingRuleListStatus').textContent = '';
    $('routingRuleError').textContent = error?.message || t('routing.loadFailed');
    return false;
  }
}

async function openRoutingRuleManager() {
  if (routingRulesDialog.open && routingRuleBusy) return;
  disarmRoutingDelete();
  clearRoutingRuleForm();
  if (!routingRulesDialog.open) routingRulesDialog.showModal();
  setRoutingRuleBusy(true);
  let loaded = false;
  try {
    loaded = await loadRoutingRules();
  } finally {
    setRoutingRuleBusy(false);
  }
  if (loaded) $('routingRuleHost').focus();
}

$('manageRoutingRules').addEventListener('click', openRoutingRuleManager);
$('closeRoutingRulesDialog').addEventListener('click', () => routingRulesDialog.close());
$('cancelRoutingRule').addEventListener('click', () => clearRoutingRuleForm());
routingRulesDialog.addEventListener('close', disarmRoutingDelete);
window.api.onOpenRoutingRules?.(() => {
  show('dash');
  setPage('tower');
  openRoutingRuleManager();
});
$('routingRuleList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-routing-action]');
  const index = Number(button?.dataset.routingIndex);
  const rule = Number.isInteger(index) ? routingRules[index] : null;
  if (!button || !rule || routingRuleBusy) return;
  if (button.dataset.routingAction === 'cancel-delete') {
    disarmRoutingDelete();
    renderRoutingRuleList();
    return;
  }
  if (button.dataset.routingAction === 'edit') {
    editRoutingRule(rule, index);
    return;
  }
  if (button.dataset.routingAction !== 'delete') return;
  if (pendingRoutingDeleteKey !== routingRuleKey(rule)) {
    armRoutingDelete(rule);
    return;
  }
  disarmRoutingDelete();
  setRoutingRuleBusy(true);
  $('routingRuleError').textContent = '';
  $('routingRuleSaved').textContent = '';
  try {
    const result = await window.api.deleteRoutingRule({
      host: rule.host,
      includeSubdomains: rule.includeSubdomains,
    });
    if (result?.ok === false) throw new Error(operationError(result, t('routing.deleteFailed')));
    const rules = collectionFromResult(result, 'rules');
    if (rules) {
      routingRules = routingRulesForView(rules);
      renderRoutingRuleList();
    } else {
      await loadRoutingRules();
    }
    if ($('routingOriginalHost').value === rule.host
        && ($('routingOriginalScope').value === 'subdomains') === rule.includeSubdomains) {
      clearRoutingRuleForm({ keepMessages: true });
    }
    $('routingRuleSaved').textContent = t('routing.deleted');
  } catch (error) {
    $('routingRuleError').textContent = error?.message || t('routing.deleteFailed');
  } finally {
    setRoutingRuleBusy(false);
  }
});

$('routingRuleForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (routingRuleBusy) return;
  $('routingRuleError').textContent = '';
  $('routingRuleSaved').textContent = '';
  let host;
  try {
    host = normalizeRoutingHostInput($('routingRuleHost').value);
  } catch (error) {
    $('routingRuleError').textContent = error?.message || t('routing.invalidHost');
    $('routingRuleHost').focus();
    return;
  }
  const scope = $('routingRuleScope').value;
  const route = $('routingRuleRoute').value;
  if (!['exact', 'subdomains'].includes(scope) || !['campus', 'direct'].includes(route)) {
    $('routingRuleError').textContent = t('routing.saveFailed');
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
  setRoutingRuleBusy(true);
  try {
    const result = await window.api.saveRoutingRule(payload);
    if (result?.ok === false) throw new Error(operationError(result, t('routing.saveFailed')));
    const rules = collectionFromResult(result, 'rules');
    if (rules) {
      routingRules = routingRulesForView(rules);
      renderRoutingRuleList();
    } else {
      await loadRoutingRules();
    }
    clearRoutingRuleForm({ keepMessages: true });
    $('routingRuleSaved').textContent = t('routing.saved');
  } catch (error) {
    $('routingRuleError').textContent = error?.message || t('routing.saveFailed');
  } finally {
    setRoutingRuleBusy(false);
  }
});

// Certificate trust ---------------------------------------------------------
function certificatePinsForView(input) {
  return (Array.isArray(input) ? input : []).filter((pin) => (
    pin && typeof pin.origin === 'string' && pin.origin.length <= 2048
    && typeof pin.fingerprint === 'string' && /^[a-f0-9]{64}$/iu.test(pin.fingerprint)
  )).slice(0, 32).map((pin) => ({
    origin: pin.origin,
    fingerprint: pin.fingerprint.toLowerCase(),
    updatedAt: pin.updatedAt,
  }));
}

function disarmCertificateDelete() {
  pendingCertificateOrigin = '';
  clearTimeout(pendingCertificateDeleteTimer);
  pendingCertificateDeleteTimer = null;
}

function armCertificateDelete(origin) {
  pendingCertificateOrigin = origin;
  clearTimeout(pendingCertificateDeleteTimer);
  pendingCertificateDeleteTimer = setTimeout(() => {
    disarmCertificateDelete();
    renderCertificatePinList();
  }, 4000);
  renderCertificatePinList();
}

function renderCertificatePinList() {
  $('certificatePinList').innerHTML = certificatePins.map((pin, index) => {
    const pending = pendingCertificateOrigin === pin.origin;
    const disabled = certificatePinBusy ? ' disabled' : '';
    const actions = pending
      ? `<button class="mini confirm-action" type="button" data-certificate-action="delete" data-certificate-index="${index}"${disabled}>${esc(t('certificates.confirmRevoke'))}</button>`
        + `<button class="mini" type="button" data-certificate-action="cancel-delete" data-certificate-index="${index}"${disabled}>${esc(t('certificates.cancelRevoke'))}</button>`
      : `<button class="mini danger-action" type="button" data-certificate-action="delete" data-certificate-index="${index}"${disabled}>${esc(t('certificates.revoke'))}</button>`;
    return `<div class="manager-item certificate-pin-item" role="listitem">`
      + `<div class="manager-item-main"><div class="manager-item-title">${esc(pin.origin)}</div>`
      + `<code class="certificate-fingerprint">${esc(pin.fingerprint)}</code>`
      + `<span class="manager-time">${esc(t('certificates.updated', { time: formatManagerTime(pin.updatedAt) }))}</span></div>`
      + `<div class="manager-item-actions">${actions}</div></div>`;
  }).join('');
  $('certificatePinStatus').textContent = certificatePins.length ? '' : t('certificates.empty');
}

function setCertificatePinBusy(busy) {
  certificatePinBusy = busy;
  $('certificatePinList').setAttribute('aria-busy', String(busy));
  renderCertificatePinList();
}

async function loadCertificatePins() {
  $('certificatePinList').innerHTML = '';
  $('certificatePinStatus').textContent = t('certificates.loading');
  $('certificatePinError').textContent = '';
  $('certificatePinSaved').textContent = '';
  try {
    const result = await window.api.listCertificatePins();
    if (result?.ok === false) throw new Error(operationError(result, t('certificates.loadFailed')));
    const pins = collectionFromResult(result, 'pins');
    if (!pins) throw new Error(t('certificates.loadFailed'));
    certificatePins = certificatePinsForView(pins);
    renderCertificatePinList();
    return true;
  } catch (error) {
    certificatePins = [];
    $('certificatePinList').innerHTML = '';
    $('certificatePinStatus').textContent = '';
    $('certificatePinError').textContent = error?.message || t('certificates.loadFailed');
    return false;
  }
}

async function openCertificatePinManager() {
  if (certificatePinsDialog.open && certificatePinBusy) return;
  disarmCertificateDelete();
  if (!certificatePinsDialog.open) certificatePinsDialog.showModal();
  setCertificatePinBusy(true);
  try {
    await loadCertificatePins();
    $('closeCertificatePinsDialog').focus();
  } finally {
    setCertificatePinBusy(false);
  }
}

$('manageCertificatePins').addEventListener('click', openCertificatePinManager);
$('closeCertificatePinsDialog').addEventListener('click', () => certificatePinsDialog.close());
certificatePinsDialog.addEventListener('close', disarmCertificateDelete);
$('certificatePinList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-certificate-action]');
  const index = Number(button?.dataset.certificateIndex);
  const pin = Number.isInteger(index) ? certificatePins[index] : null;
  if (!button || !pin || certificatePinBusy) return;
  if (button.dataset.certificateAction === 'cancel-delete') {
    disarmCertificateDelete();
    renderCertificatePinList();
    return;
  }
  if (button.dataset.certificateAction !== 'delete') return;
  if (pendingCertificateOrigin !== pin.origin) {
    armCertificateDelete(pin.origin);
    return;
  }
  disarmCertificateDelete();
  setCertificatePinBusy(true);
  $('certificatePinError').textContent = '';
  $('certificatePinSaved').textContent = '';
  try {
    const result = await window.api.deleteCertificatePin({
      origin: pin.origin,
      fingerprint: pin.fingerprint,
    });
    if (result?.ok === false) throw new Error(operationError(result, t('certificates.deleteFailed')));
    const pins = collectionFromResult(result, 'pins');
    if (pins) {
      certificatePins = certificatePinsForView(pins);
      renderCertificatePinList();
    } else {
      await loadCertificatePins();
    }
    $('certificatePinSaved').textContent = t('certificates.revoked');
  } catch (error) {
    $('certificatePinError').textContent = error?.message || t('certificates.deleteFailed');
  } finally {
    setCertificatePinBusy(false);
  }
});

// control tower
async function saveTower() {
  if (towerSaving || proxyAuthSaving) return { ok: false, busy: true };
  const port = Number($('towerPort').value);
  const maxAttempts = Number($('maxAttempts').value);
  if (!Number.isInteger(port) || port < 1025 || port > 65535) {
    flashSaved(t('tower.portInvalid'), true);
    $('towerPort').focus();
    return { ok: false };
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 10) {
    flashSaved(t('tower.attemptsInvalid'), true);
    $('maxAttempts').focus();
    return { ok: false };
  }

  towerSaving = true;
  $('towerSave').disabled = true;
  $('towerReconnect').disabled = true;
  $('strictProxyAuth').disabled = true;
  try {
    const result = await window.api.save({
      port,
      autoReconnect: $('autoReconnect').checked,
      maxAttempts,
      startAtLogin: $('startAtLogin').checked,
      autoConnect: $('autoConnect').checked,
      routeDomains: $('routeDomains').value,
    });
    if (!result?.ok) {
      flashSaved(result?.error || t('tower.saveFailed'), true);
      return result || { ok: false };
    }
    settings = result.settings || settings;
    towerDirty = false;
    await refreshState();
    return result;
  } catch (error) {
    flashSaved(error?.message || t('tower.saveFailed'), true);
    return { ok: false };
  } finally {
    towerSaving = false;
    $('towerSave').disabled = false;
    $('towerReconnect').disabled = false;
    $('strictProxyAuth').disabled = false;
  }
}

async function applyStrictProxyAuth(requested) {
  const checkbox = $('strictProxyAuth');
  const previous = settings.strictProxyAuth === true;
  if (proxyAuthSaving || towerSaving) {
    checkbox.checked = previous;
    return { ok: false, busy: true };
  }
  if (requested === previous) return { ok: true, unchanged: true };

  proxyAuthSaving = true;
  checkbox.disabled = true;
  $('towerSave').disabled = true;
  $('towerReconnect').disabled = true;
  flashSaved(t('tower.proxyAuthSwitching'));
  try {
    // This switch owns a separate settings transaction. Unsaved port, PAC,
    // retry, and launch fields stay untouched in the form and on disk.
    const result = await window.api.save({ strictProxyAuth: requested });
    if (!result?.ok) {
      checkbox.checked = previous;
      flashSaved(result?.error || t('tower.saveFailed'), true);
      return result || { ok: false };
    }
    settings = result.settings || { ...settings, strictProxyAuth: requested };
    checkbox.checked = settings.strictProxyAuth === true;
    const stateLabel = t(checkbox.checked ? 'tower.proxyAuthOn' : 'tower.proxyAuthOff');
    flashSaved(result.warning || t(
      result.reconnected ? 'tower.proxyAuthReconnected' : 'tower.proxyAuthApplied',
      { state: stateLabel },
    ), !!result.warning);
    return result;
  } catch (error) {
    checkbox.checked = previous;
    flashSaved(error?.message || t('tower.saveFailed'), true);
    return { ok: false };
  } finally {
    proxyAuthSaving = false;
    checkbox.disabled = false;
    $('towerSave').disabled = false;
    $('towerReconnect').disabled = false;
  }
}
let flashTimer = null;
function flashSaved(msg, isError = false) {
  clearTimeout(flashTimer);
  $('towerSaved').textContent = msg || t('tower.saved');
  $('towerSaved').classList.toggle('error', isError);
  flashTimer = setTimeout(() => {
    $('towerSaved').textContent = '';
    $('towerSaved').classList.remove('error');
  }, isError ? 3500 : 1800);
}
$('towerSave').addEventListener('click', async () => {
  const result = await saveTower();
  if (result?.ok) {
    flashSaved(
      result.warning || (result.reconnected ? t('tower.savedApplied') : t('tower.saved')),
      !!result.warning,
    );
  }
});
$('towerReconnect').addEventListener('click', async () => {
  const result = await saveTower();
  if (!result?.ok) return;
  if (!result.reconnected) {
    flashSaved(t('tower.reconnecting'));
    await window.api.reconnect();
  }
  flashSaved(result.warning || t('tower.savedReconnected'), !!result.warning);
});
for (const id of [
  'towerPort', 'routeDomains', 'autoReconnect', 'maxAttempts', 'startAtLogin', 'autoConnect',
]) {
  $(id).addEventListener('input', () => { towerDirty = true; });
  $(id).addEventListener('change', () => { towerDirty = true; });
}
$('strictProxyAuth').addEventListener('change', (event) => {
  void applyStrictProxyAuth(event.currentTarget.checked === true);
});
$('closeAction').addEventListener('change', async () => {
  await window.api.save({ closeAction: $('closeAction').value });
  settings.closeAction = $('closeAction').value;
});
$('language').addEventListener('change', async () => {
  await window.api.save({ language: $('language').value });
  settings.language = $('language').value;
  // get-state returns the effective locale, so this repaints in the new
  // language even for 'auto'; main also pushes it via the status channel.
  await refreshState();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshState({ preserveTower: true });
});

// copy + tools
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
  const w = b.dataset.copy;
  try {
    if ((w === 'clash' || w === 'ssh') && towerDirty) {
      const saved = await saveTower();
      if (!saved?.ok) return;
    }
    if (w === 'clash') {
      const result = await window.api.copyClashNode();
      if (!result?.ok) throw new Error(result?.error || t('tower.copyFailed'));
    } else {
      let txt = '';
      if (w === 'socks') txt = '127.0.0.1:' + (Number(settings.port) || 1080);
      else if (w === 'pac') txt = pacUrl;
      else if (w === 'ssh') txt = await window.api.sshConfig();
      if (!txt) throw new Error(t('tower.copyFailed'));
      await window.api.copy(txt);
    }
    const old = b.textContent;
    b.textContent = t('tower.copied');
    b.classList.add('done');
    setTimeout(() => { b.textContent = old; b.classList.remove('done'); }, 1200);
  } catch (error) {
    flashSaved(error?.message || t('tower.copyFailed'), true);
  }
}));
$('openBrowser').addEventListener('click', openCampus);
$('openLog2').addEventListener('click', () => window.api.openLog());

// notifications / settings
$('logRefresh').addEventListener('click', loadLogs);
$('logoutBtn').addEventListener('click', async () => {
  loginPending = false;
  const result = await window.api.logout();
  if (!result?.ok) {
    const message = result?.error || t('settings.logoutFailed');
    const refreshed = await refreshState({ preserveTower: true });
    if (refreshed.loggedIn === false) {
      $('lgUser').value = settings.username || '';
      $('lgPass').value = '';
      $('lgErr').textContent = message;
      $('lgBtn').disabled = false;
      $('lgBtn').textContent = t('login.submit');
      show('login');
    } else {
      flashSaved(message, true);
    }
    return;
  }
  await refreshState();
  $('lgPass').value = '';
  $('lgBtn').disabled = false;
  $('lgBtn').textContent = t('login.submit');
  show('login');
});
$('openLogLink').addEventListener('click', (e) => { e.preventDefault(); window.api.openLog(); });
$('checkUpdateBtn').addEventListener('click', async () => {
  $('checkUpdateBtn').disabled = true;
  try { await runUpdateCheck(true); }
  finally { $('checkUpdateBtn').disabled = false; }
});

window.api.onStatus((s) => {
  renderConnect(s);
  if (s.update) renderUpdateResult(s.update);
});
window.api.onTelemetry(renderTelemetry);
init();
