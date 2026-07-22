'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, clipboard, Tray, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const dns = require('dns');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ---------- single instance (avoid the app fighting its own session) ----------
if (!app.requestSingleInstanceLock()) { app.quit(); }

// ---------- paths & state ----------
const DATA = app.getPath('userData');
const SETTINGS = path.join(DATA, 'settings.json');
const CRED = path.join(DATA, 'cred.bin');
const RUNCONF = path.join(DATA, 'runtime.toml');
const LOG = path.join(DATA, 'engine.log');
const CHROME_PROFILE = path.join(DATA, 'campus-chrome');

const DEFAULTS = {
  server: 'remote.hkust-gz.edu.cn', port: 1080, username: '', dnsMode: 'auto', customDns: '',
  autoReconnect: true, maxAttempts: 3, keepAlive: true, proxyAll: false, customProxyDomain: '', startAtLogin: false, autoConnect: true,
  closeAction: 'ask',
  keepAliveUrl: 'http://hpc3login.hpc.hkust-gz.edu.cn/',
};
const CAMPUS_HOME = 'https://www.hkust-gz.edu.cn';

let win = null;
let tray = null;
let isQuitting = false;
let closePromptOpen = false;
let engine = null;
let connectInFlight = null;
let reconnectInFlight = null;
let userDisconnected = false;
let attempts = 0;
const MAX_ATTEMPTS = 3;
let connectedAt = null;
let gatewayIp = null;
let telemetryTimer = null;
let teleBusy = false;
let lastTele = { connCount: 0, apps: [], latencyMs: null };
let state = { connected: false, connecting: false, clientIp: null, lastError: null, pacUrl: '' };

// ---------- settings & credentials ----------
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings(s) { fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2), { mode: 0o600 }); }
// Local AES-256-GCM at-rest encryption with a per-install random key (0600 file).
// Deliberately NOT macOS Keychain/safeStorage: an ad-hoc-signed app's signature
// changes every build, so the Keychain treats each build as a new app and prompts
// for access on every launch. File-based keeps it promptless; both files are 0600.
const KEYFILE = path.join(DATA, 'key.bin');
function getKey() {
  try { const k = fs.readFileSync(KEYFILE); if (k.length === 32) return k; } catch {}
  const k = crypto.randomBytes(32);
  fs.writeFileSync(KEYFILE, k, { mode: 0o600 });
  return k;
}
function savePassword(pw) {
  if (!pw) return;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([c.update(String(pw), 'utf8'), c.final()]);
  fs.writeFileSync(CRED, Buffer.concat([iv, c.getAuthTag(), enc]), { mode: 0o600 });
}
function loadPassword() {
  try {
    const buf = fs.readFileSync(CRED);
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return ''; }  // old safeStorage cred won't decrypt -> user re-logs in once
}
function hasPassword() { return !!loadPassword(); }  // true only if it actually decrypts
function socksPort() { return Number(loadSettings().port) || 1080; }

// ---------- engine ----------
function enginePath() {
  const plat = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const ext = plat === 'windows' ? '.exe' : '';
  const named = `zju-connect-${plat}-${arch}${ext}`;
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'engine') : path.join(__dirname, 'engine');
  const candidates = [
    path.join(dir, named),
    path.join(dir, plat === 'windows' ? 'zju-connect.exe' : 'zju-connect'),
    path.join(__dirname, '..', plat === 'windows' ? 'zju-connect.exe' : 'zju-connect'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

// Resolve the gateway via reliable public DNS so a broken/asleep system resolver
// (e.g. 114.114.114.114 going unreachable after lid-sleep) can't break connecting.
// Returns an IP to use directly as server_address; falls back to the hostname.
async function resolveHost(host, s) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  const sets = [];
  if (s && s.dnsMode === 'manual' && s.customDns) sets.push([s.customDns]);
  sets.push(['223.5.5.5'], ['119.29.29.29'], ['180.76.76.76'], ['8.8.8.8']);
  for (const servers of sets) {
    try {
      const r = new dns.Resolver({ tries: 1, timeout: 3000 });
      r.setServers(servers);
      const ips = await new Promise((res, rej) => r.resolve4(host, (e, a) => (e ? rej(e) : res(a))));
      if (ips && ips.length) return ips[0];
    } catch {}
  }
  try { return (await dns.promises.lookup(host, { family: 4 })).address; } catch {}
  return host;
}

function writeRunConf(s, pw, serverAddr) {
  const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const secDns = (s.dnsMode === 'manual' && s.customDns) ? s.customDns : '223.5.5.5';
  const lines = [
    'protocol = "easyconnect"',
    `server_address = "${esc(serverAddr || s.server)}"`,
    'server_port = 443',
    `username = "${esc(s.username)}"`,
    `password = "${esc(pw)}"`,
    `socks_bind = "127.0.0.1:${Number(s.port)}"`,
    `http_bind = "127.0.0.1:${Number(s.port) + 1}"`,
    'disable_zju_config = true',
    'disable_zju_dns = false',
    'skip_domain_resource = false',
    'zju_dns_server = "auto"',
    `secondary_dns_server = "${esc(secDns)}"`,
  ];
  if (s.customProxyDomain && String(s.customProxyDomain).trim()) {
    const domains = String(s.customProxyDomain).split(',').map((domain) => domain.trim()).filter(Boolean);
    const values = domains.map((domain) => `"${esc(domain)}"`).join(', ');
    if (values) lines.push(`custom_proxy_domain = [${values}]`);
  }
  if (s.proxyAll) lines.push('proxy_all = true');
  // Keep the campus session warm even when no traffic reaches the SOCKS listener.
  // The explicit keepAlive=false toggle still wins.
  if (s.keepAlive === false) {
    lines.push('disable_keep_alive = true');
  } else {
    const kaUrl = (typeof s.keepAliveUrl === 'string' && s.keepAliveUrl.trim()) || DEFAULTS.keepAliveUrl;
    if (kaUrl) lines.push(`keep_alive_url = "${esc(kaUrl)}"`);
  }
  lines.push('');
  fs.writeFileSync(RUNCONF, lines.join('\n'), { mode: 0o600 });
}

function emit() {
  state.pacUrl = pacUrl();
  if (win && !win.isDestroyed()) win.webContents.send('status', { ...state, connectedAt });
  updateTray();
}

// The gateway permits ONE session per account (Is_enable_mult_client=0). A second
// zju-connect for the same account (the CLI/launchd autostart, or an orphan left by a
// previous crash) kicks this one → the classic "无缘无故掉线". Kill any other engine
// instance right before we start ours. Our own engine isn't spawned yet at call time.
function killStrayEngines() {
  try {
    if (process.platform === 'win32')
      // wildcard catches both zju-connect-windows-amd64.exe and the zju-connect.exe fallback
      require('child_process').execFileSync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
         "Get-Process -Name 'zju-connect*' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"],
        { stdio: 'ignore', timeout: 4000, windowsHide: true });
    else
      require('child_process').execFileSync('pkill', ['-f', 'zju-connect'], { stdio: 'ignore', timeout: 3000 });
  } catch {}
}

async function connect(isRetry) {
  if (engine) return;
  if (connectInFlight) return connectInFlight;
  connectInFlight = connectOnce(isRetry);
  try { return await connectInFlight; }
  finally { connectInFlight = null; }
}

async function connectOnce(isRetry) {
  if (engine) return;
  if (!isRetry) { attempts = 0; userDisconnected = false; }
  const s = loadSettings();
  const pw = loadPassword();
  if (!s.username || !pw) { state.connecting = false; state.lastError = '请先填写账号和密码'; emit(); return; }
  state.connecting = true; state.connected = false; state.lastError = null; state.clientIp = null;
  emit();
  const serverAddr = await resolveHost(s.server, s);
  gatewayIp = serverAddr;
  if (userDisconnected) { state.connecting = false; emit(); return; }
  writeRunConf(s, pw, serverAddr);
  try { fs.writeFileSync(LOG, ''); } catch {}
  const bin = enginePath();
  if (!fs.existsSync(bin)) { state.connecting = false; state.lastError = '引擎缺失:' + bin; emit(); return; }

  killStrayEngines(); // gateway = one session per account; clear any other engine first
  engine = spawn(bin, ['-config', RUNCONF], { stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (d) => {
    const t = d.toString();
    try { fs.appendFileSync(LOG, t); } catch {}
    if (/SOCKS5 server listening/.test(t)) { state.connecting = false; state.connected = true; attempts = 0; connectedAt = Date.now(); startTelemetry(); emit(); }
    const m = t.match(/Client IP:\s*([0-9.]+)/);
    if (m) { state.clientIp = m[1]; emit(); }
    if (/Login failed|Invalid username/.test(t)) state.lastError = '登录失败:账号或密码错误';
    else if (/Not implemented auth/.test(t)) state.lastError = '网关鉴权方式不受支持(可能已改 SSO/MFA)';
    else if (/address already in use|bind:/.test(t)) state.lastError = `端口 ${s.port} 被占用,请在控制塔换一个`;
  };
  engine.stdout.on('data', onData);
  engine.stderr.on('data', onData);
  engine.on('error', (err) => { state.connecting = false; state.lastError = '无法启动引擎:' + err.message; emit(); });
  engine.on('exit', (code) => {
    const wasConnected = state.connected;
    const uptime = connectedAt ? (Date.now() - connectedAt) : 0;
    engine = null;
    state.connected = false; state.clientIp = null; connectedAt = null;
    stopTelemetry();
    try { fs.unlinkSync(RUNCONF); } catch {}
    const authErr = /账号或密码|鉴权/.test(state.lastError || '');
    const cfg = loadSettings();
    const autoOn = cfg.autoReconnect !== false;
    const maxA = Number.isInteger(cfg.maxAttempts) ? cfg.maxAttempts : MAX_ATTEMPTS;
    // user-initiated stop or bad credentials → never auto-reconnect
    if (userDisconnected || authErr) { state.connecting = false; emit(); return; }
    // A session that stayed up a while and THEN dropped (gateway kick / engine gvisor
    // panic / network blip / idle timeout) gets a FRESH retry budget so it always
    // recovers — this is the fix for "无缘无故掉线". A connection that died almost
    // immediately keeps counting against maxA so a hard failure can't hammer the gateway.
    if (wasConnected && uptime > 20000) attempts = 0;
    if (autoOn && attempts < maxA) {
      attempts++;
      const delay = Math.min(2000 * attempts, 15000); // linear backoff, capped at 15s
      state.connecting = true;
      state.lastError = wasConnected ? '连接中断,正在自动重连…' : null;
      emit();
      setTimeout(() => connect(true), delay);
      return;
    }
    state.connecting = false;
    if (!state.lastError) state.lastError = wasConnected
      ? '连接已断开,自动重连多次失败,请手动重连或查看日志'
      : (code ? '连接失败,请重试或查看日志' : null);
    emit();
  });
}
function disconnect() { userDisconnected = true; connectedAt = null; stopTelemetry(); if (engine) engine.kill(); }

function waitForConnectionIdle(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      if (!connectInFlight && !engine) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(poll, 50);
    };
    poll();
  });
}

async function reconnect() {
  if (reconnectInFlight) return reconnectInFlight;
  reconnectInFlight = (async () => {
    disconnect();
    if (!await waitForConnectionIdle()) {
      state.connecting = false;
      state.lastError = '引擎未能停止，请退出程序后重试';
      emit();
      return { ok: false };
    }
    await connect();
    return { ok: true };
  })();
  try { return await reconnectInFlight; }
  finally { reconnectInFlight = null; }
}

// ---------- telemetry: latency + which apps use the SOCKS tunnel ----------
const net = require('net');
function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    require('child_process').execFile(cmd, args, { timeout, windowsHide: true }, (e, so) => resolve(so || ''));
  });
}
function tcpPing(host, port) {
  return new Promise((resolve) => {
    if (!host) return resolve(null);
    const t0 = process.hrtime.bigint();
    const sock = net.connect({ host, port });
    const done = (ok) => { try { sock.destroy(); } catch {} resolve(ok ? Number(process.hrtime.bigint() - t0) / 1e6 : null); };
    sock.setTimeout(3000);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}
function friendly(n) {
  if (/Chrome|chrome/.test(n)) return 'Google Chrome';
  if (/Code Helper|Electron/.test(n)) return 'VS Code';
  if (/Microsoft Edge|msedge/.test(n)) return 'Microsoft Edge';
  if (/Lark|Feishu|飞书/.test(n)) return 'Lark/飞书';
  if (/firefox/i.test(n)) return 'Firefox';
  if (n === 'ssh' || n === 'sshd') return 'SSH';
  if (/^(curl|wget|nc|python|node)$/.test(n)) return n;
  return n;
}
const isValidPort = (p) => Number.isInteger(p) && p >= 1025 && p <= 65534;
async function listTunnelApps(P, enginePid, appPid) {
  if (!isValidPort(P)) return { connCount: 0, apps: [] };
  const ports = new Set([P, P + 1]); // SOCKS + HTTP
  try {
    if (process.platform === 'win32') {
      const ps = `$r=Get-NetTCPConnection -State Established -RemoteAddress 127.0.0.1 -EA SilentlyContinue|?{$_.RemotePort -eq ${P} -or $_.RemotePort -eq ${P + 1}}|Group-Object OwningProcess|%{$p=Get-Process -Id $_.Name -EA SilentlyContinue;[pscustomobject]@{Pid=[int]$_.Name;Name=$p.ProcessName;Count=$_.Count}};$r|ConvertTo-Json -Compress`;
      const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 4000);
      let arr = []; try { const j = JSON.parse(out); arr = Array.isArray(j) ? j : [j]; } catch {}
      const apps = arr.filter((a) => a && a.Pid !== enginePid && a.Pid !== appPid)
        .map((a) => ({ pid: a.Pid, name: friendly(a.Name || String(a.Pid)), count: a.Count }));
      return { connCount: apps.reduce((s, a) => s + (a.count || 0), 0), apps };
    }
    const out = await run('lsof', ['-nP', '-iTCP@127.0.0.1', '-sTCP:ESTABLISHED', '-F', 'pcn'], 1500);
    const tuples = new Map(); const cmd = new Map(); let pid = null;
    for (const ln of out.split('\n')) {
      const k = ln[0], v = ln.slice(1);
      if (k === 'p') pid = Number(v);
      else if (k === 'c') cmd.set(pid, v);
      else if (k === 'n') {
        const m = v.match(/->127\.0\.0\.1:(\d+)$/);
        if (m && ports.has(Number(m[1])) && pid !== enginePid && pid !== appPid) tuples.set(v, pid);
      }
    }
    const perPid = new Map();
    for (const p of tuples.values()) perPid.set(p, (perPid.get(p) || 0) + 1);
    const apps = [];
    for (const [p, count] of perPid) {
      let name = cmd.get(p) || String(p);
      const full = (await run('ps', ['-p', String(p), '-o', 'comm='], 800)).trim();
      if (full) name = full.split('/').pop();
      apps.push({ pid: p, name: friendly(name), count });
    }
    apps.sort((a, b) => b.count - a.count);
    return { connCount: tuples.size, apps };
  } catch { return { connCount: 0, apps: [] }; }
}
function sendTelemetry() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('telemetry', { connectedAt, ...lastTele });
}
function startTelemetry() {
  stopTelemetry();
  let tick = 0;
  const pump = async () => {
    if (teleBusy || !state.connected) return;
    teleBusy = true;
    try {
      const r = await listTunnelApps(socksPort(), engine ? engine.pid : -1, process.pid);
      lastTele.connCount = r.connCount; lastTele.apps = r.apps;
      if (tick % 2 === 0) lastTele.latencyMs = await tcpPing(gatewayIp, 443);
      tick++;
      sendTelemetry();
    } finally { teleBusy = false; }
  };
  pump();
  telemetryTimer = setInterval(pump, 2500);
}
function stopTelemetry() {
  if (telemetryTimer) clearInterval(telemetryTimer);
  telemetryTimer = null;
  lastTele = { connCount: 0, apps: [], latencyMs: null };
}

// ---------- PAC server (campus -> SOCKS, everything else direct) ----------
let pacServer = null, pacPort = 0;
function pacBody() {
  const p = socksPort();
  return `function FindProxyForURL(url, host) {
  if (dnsDomainIs(host, ".hkust-gz.edu.cn") || dnsDomainIs(host, ".hkust.edu.hk") ||
      shExpMatch(host, "10.120.*") || isInNet(host, "10.0.0.0", "255.0.0.0") ||
      isInNet(dnsResolve(host) || "0.0.0.0", "10.0.0.0", "255.0.0.0"))
    return "SOCKS5 127.0.0.1:${p}; SOCKS 127.0.0.1:${p}";
  return "DIRECT";
}
`;
}
function startPac() {
  pacServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig');
    res.end(pacBody());
  });
  pacServer.on('error', () => {});
  pacServer.listen(0, '127.0.0.1', () => { pacPort = pacServer.address().port; emit(); });
}
function pacUrl() { return pacPort ? `http://127.0.0.1:${pacPort}/proxy.pac` : ''; }

function openCampusBrowser() {
  const pac = pacUrl();
  if (!pac) { state.lastError = 'PAC 未就绪'; emit(); return; }
  const args = [
    `--proxy-pac-url=${pac}`,
    `--user-data-dir=${CHROME_PROFILE}`,
    '--no-first-run', '--no-default-browser-check', CAMPUS_HOME,
  ];
  let child;
  if (process.platform === 'darwin') child = spawn('open', ['-na', 'Google Chrome', '--args', ...args]);
  else if (process.platform === 'win32') child = spawn('cmd', ['/c', 'start', 'chrome', ...args], { shell: true });
  else child = spawn('google-chrome', args);
  child.on('error', () => { state.lastError = '未找到 Chrome,请手动用 PAC 地址'; emit(); });
}

// ---------- IPC ----------
ipcMain.handle('get-state', () => ({
  ...state, connectedAt, settings: loadSettings(), hasPassword: hasPassword(), pacUrl: pacUrl(),
  loggedIn: hasPassword() && !!loadSettings().username, platform: process.platform,
}));
ipcMain.handle('save', (_e, p) => {
  const next = { ...loadSettings() };
  if (p && p.username != null) next.username = String(p.username);
  if (p && p.server) next.server = String(p.server).trim();
  if (p && p.port != null) { const n = Number(p.port); if (isValidPort(n)) next.port = n; }
  if (p && p.dnsMode) next.dnsMode = p.dnsMode;
  if (p && typeof p.customDns === 'string') next.customDns = p.customDns.trim();
  if (p && typeof p.customProxyDomain === 'string') next.customProxyDomain = p.customProxyDomain.trim();
  if (p && typeof p.keepAliveUrl === 'string') next.keepAliveUrl = p.keepAliveUrl.trim();
  if (p && p.maxAttempts != null) next.maxAttempts = Math.max(0, Math.min(10, Number(p.maxAttempts) || 0));
  if (p && ['ask', 'minimize', 'quit'].includes(p.closeAction)) next.closeAction = p.closeAction;
  for (const b of ['autoReconnect', 'keepAlive', 'proxyAll', 'startAtLogin', 'autoConnect']) if (p && typeof p[b] === 'boolean') next[b] = p[b];
  saveSettings(next);
  if (p && typeof p.password === 'string' && p.password.length) savePassword(p.password);
  if (p && typeof p.startAtLogin === 'boolean') { try { app.setLoginItemSettings({ openAtLogin: p.startAtLogin }); } catch {} }
  return { ok: true };
});
ipcMain.handle('connect', async () => { await connect(); return { ok: true }; });
ipcMain.handle('disconnect', () => { disconnect(); return { ok: true }; });
ipcMain.handle('reconnect', reconnect);
ipcMain.handle('ssh-config', () => {
  const port = socksPort();
  const note = '# Direct Host blocks only; do not combine with ProxyJump.';
  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : '',
    ].filter(Boolean);
    const candidates = roots.map((root) => path.join(root, 'Git', 'mingw64', 'bin', 'connect.exe'));
    const connectExe = (candidates.find((candidate) => fs.existsSync(candidate)) || 'connect.exe').replace(/\\/g, '/');
    return `${note}\nProxyCommand "${connectExe}" -S 127.0.0.1:${port} %h %p`;
  }
  return `${note}\nProxyCommand /usr/bin/nc -X 5 -x 127.0.0.1:${port} %h %p`;
});
ipcMain.handle('logout', () => {
  disconnect();
  try { fs.unlinkSync(CRED); } catch {}
  return { ok: true };
});
ipcMain.handle('get-logs', () => {
  try { return fs.readFileSync(LOG, 'utf8').split('\n').slice(-300).join('\n'); }
  catch { return ''; }
});
ipcMain.handle('open-log', () => shell.openPath(LOG));
ipcMain.handle('copy', (_e, text) => { clipboard.writeText(String(text || '')); return { ok: true }; });
ipcMain.handle('open-campus-browser', () => { openCampusBrowser(); return { ok: true }; });
ipcMain.handle('resize', (_e, h) => {
  if (win && !win.isDestroyed()) {
    const [w] = win.getContentSize();
    win.setContentSize(w, Math.max(360, Math.min(980, Math.ceil(h))));
  }
});

// ---------- window ----------
function showWindow() {
  if (!app.isReady()) return;
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const status = state.connecting ? '连接中' : state.connected ? '已连接' : '未连接';
  tray.setToolTip(`HKUST(GZ) Connect - ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWindow },
    { label: `状态：${status}`, enabled: false },
    { type: 'separator' },
    { label: '退出程序', click: requestQuit },
  ]));
}

function createTray() {
  if (tray && !tray.isDestroyed()) return true;
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const image = nativeImage.createFromPath(path.join(__dirname, 'build', iconName));
  if (image.isEmpty()) return false;
  tray = new Tray(image);
  tray.on('double-click', showWindow);
  updateTray();
  return true;
}

function hideToTray() {
  if (!createTray()) return false;
  if (win && !win.isDestroyed()) win.hide();
  return true;
}

function rememberCloseAction(action) {
  const next = loadSettings();
  next.closeAction = action;
  saveSettings(next);
}

function requestQuit() {
  if (isQuitting) return;
  isQuitting = true;
  app.quit();
}

async function handleWindowClose(event) {
  if (isQuitting) return;
  event.preventDefault();

  const action = loadSettings().closeAction;
  if (action === 'quit') {
    requestQuit();
    return;
  }
  if (action === 'minimize') {
    hideToTray();
    return;
  }
  if (closePromptOpen || !win || win.isDestroyed()) return;

  closePromptOpen = true;
  try {
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      title: '关闭 HKUST(GZ) Connect',
      message: '关闭窗口时要执行什么操作？',
      detail: '最小化到托盘会保持校园网络连接。',
      buttons: ['最小化到托盘', '退出程序', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: '记住我的选择（可在设置中更改）',
      checkboxChecked: false,
    });

    if (result.response === 0) {
      if (result.checkboxChecked) rememberCloseAction('minimize');
      hideToTray();
    } else if (result.response === 1) {
      if (result.checkboxChecked) rememberCloseAction('quit');
      requestQuit();
    }
  } finally {
    closePromptOpen = false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 700,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    title: 'HKUST(GZ) Connect',
    backgroundColor: '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', handleWindowClose);
  win.on('closed', () => { win = null; });
}

app.on('second-instance', showWindow);
app.whenReady().then(() => {
  if (process.platform === 'darwin') Menu.setApplicationMenu(null);
  startPac();
  createTray();
  createWindow();
  const settings = loadSettings();
  if (settings.autoConnect !== false && settings.username && hasPassword()) setTimeout(() => connect(), 500);
  app.on('activate', showWindow);
});
app.on('window-all-closed', () => { /* Keep the tray process alive. */ });
app.on('before-quit', () => {
  isQuitting = true;
  disconnect();
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
});
