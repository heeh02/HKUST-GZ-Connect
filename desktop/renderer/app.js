'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
function setPage(page) {
  document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  document.querySelectorAll('.page').forEach((p) => { const on = p.dataset.page === page; p.classList.toggle('active', on); p.hidden = !on; });
  if (page === 'notif') loadLogs();
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
  return { pending: true, view: 'login', clearPassword: false, error: '正在连接…' };
}

function visibleResources(resources, expanded, limit = 4) {
  const items = Array.isArray(resources) ? resources : [];
  return expanded ? items : items.slice(0, Math.max(0, limit));
}

function routeLabel(resource) {
  return resource?.route === 'direct' ? '直连' : '校园隧道';
}

function updateLoginProgress(s) {
  if (!loginPending) return;
  const next = evaluateLoginProgress(loginPending, s);
  $('lgBtn').disabled = next.pending;
  $('lgBtn').textContent = next.pending ? '连接中…' : '登录并连接';
  $('lgErr').textContent = next.error;
  if (next.pending) return;
  loginPending = false;
  if (next.clearPassword) $('lgPass').value = '';
  show(next.view);
  if (next.view === 'dash') setPage('connect');
}

function renderConnect(s) {
  st = s;
  connectedAt = s.connected ? (s.connectedAt || connectedAt) : null;
  $('power').classList.toggle('on', s.connected);
  $('power').classList.toggle('busy', s.connecting);
  const wrap = document.querySelector('.conn-status');
  wrap.classList.toggle('on', s.connected); wrap.classList.toggle('busy', s.connecting);
  $('connStatus').textContent = s.connecting ? '连接中…' : s.connected ? '已连接' : '未连接';
  $('connIp').textContent = s.connected && s.clientIp ? s.clientIp : '—';
  $('connTop').classList.toggle('connected', s.connected);
  $('connErr').textContent = (!s.connected && !s.connecting && s.lastError) ? s.lastError : '';
  $('quickCampus').disabled = campusActionBusy;
  $('quickCampus').textContent = campusActionBusy
    ? (s.connected ? '正在打开…' : '正在连接，完成后自动打开…')
    : (s.connected ? '打开校园网站' : '连接并打开校园网站');
  $('statGrid').hidden = !s.connected;
  $('appsCard').hidden = !s.connected;
  $('stIp').textContent = s.clientIp || '—';
  if (s.connected && connectedAt) { startDur(); $('stDur').textContent = fmtDur(Date.now() - connectedAt); }
  else { stopDur(); $('stDur').textContent = '0:00'; $('stPing').textContent = '—'; $('stConn').textContent = '0'; $('appList').innerHTML = ''; }
  updateLoginProgress(s);
}

function renderTelemetry(t) {
  if (t.connectedAt) connectedAt = t.connectedAt;
  $('stPing').textContent = (t.latencyMs != null) ? Math.round(t.latencyMs) + ' ms' : '—';
  $('stConn').textContent = t.connCount || 0;
  const list = $('appList');
  if (!t.apps || !t.apps.length) { list.innerHTML = '<div class="app-empty">暂无程序在用隧道(浏览器走 PAC 或 ssh 后显示)</div>'; return; }
  list.innerHTML = t.apps.map((a) =>
    `<div class="app-row"><span class="app-dot"></span><span class="app-name">${esc(a.name)}</span><span class="app-meta">${a.count} 连接</span></div>`).join('');
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
  toggle.textContent = resourcesExpanded ? '收起' : '展开全部';
  toggle.setAttribute('aria-expanded', String(resourcesExpanded));
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
  settings = s.settings || {}; pacUrl = s.pacUrl || '';
  campusResources = Array.isArray(s.campusResources) ? s.campusResources : [];
  renderConnect(s);
  renderResources();
  $('socksEndpoint').textContent = '127.0.0.1:' + (Number(settings.port) || 1080);
  if (!preserveTower || !towerDirty) populateTowerForm();
  $('acct').textContent = settings.username || '—';
  $('ver').textContent = s.version ? `v${s.version}` : '—';
  $('closeAction').value = ['ask', 'minimize', 'quit'].includes(settings.closeAction) ? settings.closeAction : 'ask';
  return s;
}

async function loadLogs() {
  const t = await window.api.getLogs();
  const box = $('logs');
  box.textContent = t && t.trim() ? t : '(暂无日志,连接后这里显示运行/错误信息)';
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
  if (!u) { $('lgErr').textContent = '请填写账号'; return; }
  if (!p) { $('lgErr').textContent = '请填写密码'; return; }
  const saved = await window.api.save({ username: u, password: p });
  if (!saved.ok) { $('lgErr').textContent = saved.error || '密码保存失败'; return; }
  loginPending = true;
  $('lgBtn').disabled = true;
  $('lgBtn').textContent = '连接中…';
  $('lgErr').textContent = '正在连接…';
  try {
    await window.api.connect();
    await refreshState();
  } catch (error) {
    loginPending = false;
    $('lgBtn').disabled = false;
    $('lgBtn').textContent = '登录并连接';
    $('lgErr').textContent = error?.message || '连接失败，请重试';
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
    button.textContent = expanded ? '收起' : '展开';
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
    if (!result || !result.ok) $('quickErr').textContent = result?.error || '校园浏览器打开失败';
  } finally {
    campusActionBusy = false;
    renderConnect(st);
  }
}
$('quickCampus').addEventListener('click', openCampus);
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
  $('resourceId').value = '';
  $('resourceName').value = '';
  $('resourceUrl').value = '';
  $('resourceDescription').value = '';
  $('resourceRoute').value = 'campus';
  $('resourceFormError').textContent = '';
  document.querySelectorAll('.resource-editor-row').forEach((row) => row.classList.remove('active'));
}

function fillResourceEditor(resource) {
  $('resourceId').value = resource?.builtin ? '' : (resource?.id || '');
  $('resourceName').value = resource?.name || '';
  $('resourceUrl').value = resource?.url || '';
  $('resourceDescription').value = resource?.description || '';
  $('resourceRoute').value = resource?.route === 'direct' ? 'direct' : 'campus';
  $('resourceFormError').textContent = resource?.builtin ? '内置网站不能覆盖，请新增一个自定义入口' : '';
  document.querySelectorAll('.resource-editor-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.resourceId === resource?.id);
  });
}

function renderResourceEditorList() {
  $('resourceEditorList').innerHTML = campusResources.map((resource) => {
    const custom = !resource.builtin;
    const actions = custom
      ? `<button class="mini" type="button" data-resource-action="edit">编辑</button>`
        + `<button class="mini" type="button" data-resource-action="up">↑</button>`
        + `<button class="mini" type="button" data-resource-action="down">↓</button>`
        + `<button class="mini" type="button" data-resource-action="delete">删除</button>`
      : '<span class="resource-editor-route">内置</span>';
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
$('newResource').addEventListener('click', clearResourceEditor);
$('resourceEditorList').addEventListener('click', async (event) => {
  const row = event.target.closest('[data-resource-id]');
  if (!row) return;
  const resource = campusResources.find((item) => item.id === row.dataset.resourceId);
  const action = event.target.closest('[data-resource-action]')?.dataset.resourceAction;
  if (!resource || resource.builtin) return;
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
  if (action === 'delete') {
    if (!window.confirm(`删除“${resource.name}”？`)) return;
    const result = await window.api.deleteResource(resource.id);
    if (!result?.ok) { $('resourceFormError').textContent = result?.error || '删除失败'; return; }
    campusResources = result.resources || campusResources.filter((item) => item.id !== resource.id);
    renderResources();
    renderResourceEditorList();
    clearResourceEditor();
  }
});
$('resourceForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await window.api.saveResource({
    id: $('resourceId').value || undefined,
    name: $('resourceName').value,
    url: $('resourceUrl').value,
    description: $('resourceDescription').value,
    route: $('resourceRoute').value,
  });
  if (!result?.ok) { $('resourceFormError').textContent = result?.error || '保存失败'; return; }
  campusResources = result.resources || campusResources;
  renderResources();
  renderResourceEditorList();
  clearResourceEditor();
});

// control tower
async function saveTower() {
  if (towerSaving) return { ok: false, busy: true };
  const port = Number($('towerPort').value);
  const maxAttempts = Number($('maxAttempts').value);
  if (!Number.isInteger(port) || port < 1025 || port > 65535) {
    flashSaved('端口必须是 1025–65535 的整数', true);
    $('towerPort').focus();
    return { ok: false };
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 10) {
    flashSaved('重试次数必须是 0–10 的整数', true);
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
      flashSaved(result?.error || '保存失败，请重试', true);
      return result || { ok: false };
    }
    settings = result.settings || settings;
    towerDirty = false;
    await refreshState();
    return result;
  } catch (error) {
    flashSaved(error?.message || '保存失败，请重试', true);
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
  $('towerSaved').textContent = msg || '已保存 ✓';
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
      result.warning || (result.reconnected ? '已保存并应用 ✓' : '已保存 ✓'),
      !!result.warning,
    );
  }
});
$('towerReconnect').addEventListener('click', async () => {
  const result = await saveTower();
  if (!result?.ok) return;
  if (!result.reconnected) {
    flashSaved('重连中…');
    await window.api.reconnect();
  }
  flashSaved(result.warning || '已保存并重连 ✓', !!result.warning);
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
  const old = b.textContent; b.textContent = '已复制'; b.classList.add('done');
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
  $('lgBtn').textContent = '登录并连接';
  show('login');
});
$('openLogLink').addEventListener('click', (e) => { e.preventDefault(); window.api.openLog(); });

window.api.onStatus(renderConnect);
window.api.onTelemetry(renderTelemetry);
init();
