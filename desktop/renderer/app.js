'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Active UI language. Chinese until get-state reports the real system locale.
let t = window.I18N.createT('zh');
let st = { connected: false, connecting: false, clientIp: null, lastError: null };
let settings = {};
let connectedAt = null;
let durTimer = null;
let pacUrl = '';
let campusActionBusy = false;
let campusResources = [];
let resourcesExpanded = false;
let towerDirty = false;
let towerSaving = false;
let loginPending = false;
const resourceDialog = $('resourceDialog');

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
  $('quickCampus').disabled = campusActionBusy;
  $('quickAddCampus').disabled = campusActionBusy;
  $('quickCampus').textContent = campusActionBusy
    ? (s.connected ? t('quick.opening') : t('quick.connectThenOpen'))
    : (s.connected ? t('quick.open') : t('quick.connectOpen'));
  $('statGrid').hidden = !s.connected;
  $('appsCard').hidden = !s.connected;
  $('stIp').textContent = s.clientIp || '—';
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
function setUpdateHint(html, { sticky = false } = {}) {
  const el = $('updateHint');
  if (updateHintTimer) { clearTimeout(updateHintTimer); updateHintTimer = null; }
  el.innerHTML = html || '';
  el.hidden = !html;
  if (html && !sticky) updateHintTimer = setTimeout(() => { el.hidden = true; }, 3500);
}
function renderUpdateResult(result, { manual = false } = {}) {
  if (result && result.updateAvailable) {
    setUpdateHint(
      t('settings.updateAvailable', {
        version: esc(result.latestVersion),
        button: t('settings.updateDownload'),
      }),
      { sticky: true },
    );
    $('updateDownload').addEventListener('click', () => window.api.openExternal(result.url));
  } else if (manual) {
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
  const saved = await window.api.save({ username: u, password: p });
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

// control tower
async function saveTower() {
  if (towerSaving) return { ok: false, busy: true };
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
  const w = b.dataset.copy; let txt = '';
  if (w === 'socks') txt = '127.0.0.1:' + (Number(settings.port) || 1080);
  else if (w === 'pac') txt = pacUrl;
  else if (w === 'ssh') txt = await window.api.sshConfig();
  if (!txt) return;
  await window.api.copy(txt);
  const old = b.textContent; b.textContent = t('tower.copied'); b.classList.add('done');
  setTimeout(() => { b.textContent = old; b.classList.remove('done'); }, 1200);
}));
$('openBrowser').addEventListener('click', openCampus);
$('openLog2').addEventListener('click', () => window.api.openLog());

// notifications / settings
$('logRefresh').addEventListener('click', loadLogs);
$('logoutBtn').addEventListener('click', async () => {
  loginPending = false;
  await window.api.logout();
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
