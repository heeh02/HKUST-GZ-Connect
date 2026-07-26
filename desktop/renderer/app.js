'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let st = { connected: false, connecting: false, clientIp: null, lastError: null };
let settings = {};
let connectedAt = null;
let durTimer = null;
let pacUrl = '';

function show(view) { $('login').hidden = view !== 'login'; $('dash').hidden = view !== 'dash'; }
function setPage(page) {
  document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  document.querySelectorAll('.page').forEach((p) => { const on = p.dataset.page === page; p.classList.toggle('active', on); p.hidden = !on; });
  if (page === 'notif') loadLogs();
}
function fmtDur(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }
function startDur() { stopDur(); durTimer = setInterval(() => { if (connectedAt) $('stDur').textContent = fmtDur(Date.now() - connectedAt); }, 1000); }
function stopDur() { if (durTimer) clearInterval(durTimer); durTimer = null; }

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
  $('statGrid').hidden = !s.connected;
  $('appsCard').hidden = !s.connected;
  $('stIp').textContent = s.clientIp || '—';
  if (s.connected && connectedAt) { startDur(); $('stDur').textContent = fmtDur(Date.now() - connectedAt); }
  else { stopDur(); $('stDur').textContent = '0:00'; $('stPing').textContent = '—'; $('stConn').textContent = '0'; $('appList').innerHTML = ''; }
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

async function refreshState() {
  const s = await window.api.getState();
  settings = s.settings || {}; pacUrl = s.pacUrl || '';
  renderConnect(s);
  $('towerPort').value = settings.port || 1080;
  $('socksEndpoint').textContent = '127.0.0.1:' + (Number(settings.port) || 1080);
  $('routeDomains').value = (settings.routeDomains || []).join('\n');
  $('autoReconnect').checked = settings.autoReconnect !== false;
  $('maxAttempts').value = settings.maxAttempts ?? 3;
  $('startAtLogin').checked = !!settings.startAtLogin;
  $('autoConnect').checked = settings.autoConnect !== false;
  $('acct').textContent = settings.username || '—';
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
  const u = $('lgUser').value.trim(), p = $('lgPass').value;
  if (!u) { $('lgErr').textContent = '请填写账号'; return; }
  if (!p) { $('lgErr').textContent = '请填写密码'; return; }
  const saved = await window.api.save({ username: u, password: p });
  if (!saved.ok) { $('lgErr').textContent = saved.error || '密码保存失败'; return; }
  $('lgPass').value = ''; $('lgErr').textContent = '';
  await refreshState(); show('dash'); setPage('connect');
});
$('lgPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lgBtn').click(); });

// nav + power
document.querySelectorAll('.nav').forEach((n) => n.addEventListener('click', () => setPage(n.dataset.page)));
$('power').addEventListener('click', async () => {
  if (st.connecting) return;
  if (st.connected) await window.api.disconnect(); else await window.api.connect();
});

// control tower
async function saveTower() {
  await window.api.save({
    port: $('towerPort').value,
    autoReconnect: $('autoReconnect').checked,
    maxAttempts: Number($('maxAttempts').value) || 0,
    startAtLogin: $('startAtLogin').checked,
    autoConnect: $('autoConnect').checked,
    routeDomains: $('routeDomains').value,
  });
  await refreshState();
}
function flashSaved(msg) { $('towerSaved').textContent = msg || '已保存 ✓'; setTimeout(() => { $('towerSaved').textContent = ''; }, 1500); }
$('towerSave').addEventListener('click', async () => { await saveTower(); flashSaved(); });
$('towerReconnect').addEventListener('click', async () => { await saveTower(); flashSaved('重连中…'); window.api.reconnect(); });
$('closeAction').addEventListener('change', async () => {
  await window.api.save({ closeAction: $('closeAction').value });
  settings.closeAction = $('closeAction').value;
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshState();
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
$('openBrowser').addEventListener('click', () => window.api.openCampusBrowser());
$('openLog2').addEventListener('click', () => window.api.openLog());

// notifications / settings
$('logRefresh').addEventListener('click', loadLogs);
$('logoutBtn').addEventListener('click', async () => { await window.api.logout(); await refreshState(); $('lgPass').value = ''; show('login'); });
$('openLogLink').addEventListener('click', (e) => { e.preventDefault(); window.api.openLog(); });

window.api.onStatus(renderConnect);
window.api.onTelemetry(renderTelemetry);
init();
