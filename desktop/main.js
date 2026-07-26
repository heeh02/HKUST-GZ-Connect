'use strict';
const {
  app, BrowserWindow, WebContentsView, ipcMain, shell, Menu, clipboard, safeStorage, session,
  Tray, nativeImage, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { loadSettings: readSettings, saveSettings: writeSettings } = require('./lib/settings-store');
const { applySettingsPatch } = require('./lib/settings-update');
const { loadPassword: readPassword, savePassword: writePassword } = require('./lib/credential-store');
const { classifyEngineOutput } = require('./lib/engine-output');
const { exactExecutablePattern } = require('./lib/engine-process');
const { buildPac } = require('./lib/pac');
const { CampusBrowser, normalizeCampusUrl } = require('./lib/campus-browser');
const { loadCampusResources } = require('./lib/campus-resources');
const { ensureOwnerOnly } = require('./lib/private-file');
const { appendLog, readLogTail, resetLog } = require('./lib/secure-log');
const { loadTrayImage } = require('./lib/tray-icon');
const { probeSocksConnect } = require('./lib/socks-health');
const { CampusCredentialVault } = require('./lib/campus-credential-vault');

// ---------- single instance (avoid the app fighting its own session) ----------
// `app.quit()` does not stop the rest of this module from running, so return
// before a second instance touches the shared settings, credential, and log
// files that the first instance owns.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.setName('HKUST(GZ) Connect');

// ---------- paths & state ----------
const DATA = app.getPath('userData');
const SETTINGS = path.join(DATA, 'settings.json');
const CRED = path.join(DATA, 'cred.bin');
const LOG = path.join(DATA, 'engine.log');
const PAC_FILE = path.join(DATA, 'routing.pac');
const CAMPUS_CREDENTIALS = path.join(DATA, 'campus-credentials.json');
const GATEWAY_HOST = 'remote.hkust-gz.edu.cn';

for (const privateFile of [SETTINGS, CRED, LOG, PAC_FILE, CAMPUS_CREDENTIALS]) {
  ensureOwnerOnly(privateFile);
}

let win = null;
let tray = null;
let campusBrowser = null;
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
let tunnelProbeFailures = 0;
let tunnelRecoveryInFlight = false;
let lastTele = { connCount: 0, apps: [], latencyMs: null };
let state = { connected: false, connecting: false, clientIp: null, lastError: null, pacUrl: '' };

// ---------- settings & credentials ----------
function loadSettings() {
  return readSettings(SETTINGS);
}
function saveSettings(settings) { return writeSettings(SETTINGS, settings); }
function savePassword(pw) {
  return writePassword(CRED, pw, safeStorage, process.platform);
}
function loadPassword() {
  return readPassword(CRED, safeStorage, process.platform);
}
function hasPassword() { return !!loadPassword(); }  // true only if it actually decrypts
function socksPort() { return Number(loadSettings().port) || 1080; }

// ---------- engine ----------
function enginePath() {
  const plat = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const ext = plat === 'windows' ? '.exe' : '';
  const named = `ec-engine-${plat}-${arch}${ext}`;
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'engine') : path.join(__dirname, 'engine');
  const candidates = [
    path.join(dir, named),
    path.join(dir, plat === 'windows' ? 'ec-engine.exe' : 'ec-engine'),
    path.join(__dirname, '..', 'independent', 'target', 'release', plat === 'windows' ? 'ec-engine.exe' : 'ec-engine'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function engineConfigPath() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'engine', 'hkustgz.json')]
    : [path.join(__dirname, '..', 'independent', 'config', 'hkustgz.json')];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function emit() {
  state.pacUrl = pacUrl();
  if (win && !win.isDestroyed()) win.webContents.send('status', { ...state, connectedAt });
  updateTray();
}

// The gateway permits one session per account. Stop an orphaned independent
// engine before starting the new owned child.
function killStrayEngines(resolvedEnginePath) {
  try {
    if (process.platform === 'win32')
      require('child_process').execFileSync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
         "Get-Process -Name 'ec-engine*' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"],
        { stdio: 'ignore', timeout: 4000, windowsHide: true });
    else {
      const processPattern = exactExecutablePattern(resolvedEnginePath);
      if (!processPattern) return;
      require('child_process').execFileSync(
        'pkill',
        ['-f', processPattern],
        { stdio: 'ignore', timeout: 3000 },
      );
    }
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
  gatewayIp = GATEWAY_HOST;
  if (userDisconnected) { state.connecting = false; emit(); return; }
  try { resetLog(LOG); } catch {}
  const bin = enginePath();
  if (!fs.existsSync(bin)) { state.connecting = false; state.lastError = '引擎缺失:' + bin; emit(); return; }
  const engineConfig = engineConfigPath();
  if (!fs.existsSync(engineConfig)) { state.connecting = false; state.lastError = '引擎配置缺失:' + engineConfig; emit(); return; }

  killStrayEngines(bin); // gateway = one session per account; clear this app's orphan only
  engine = spawn(bin, [
    '--config', engineConfig,
    '--credentials-stdin',
    '--socks-bind', `127.0.0.1:${Number(s.port)}`,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  // An engine that dies before reading stdin (missing library, wrong
  // architecture) makes this write emit EPIPE. Without a listener that would
  // become an uncaught exception and take the whole application down, so the
  // failure is left to the 'exit' handler instead.
  engine.stdin.on('error', () => {});
  engine.stdin.end(`${s.username}\n${pw}\n`);
  let diagnosticTail = '';
  const onData = (d) => {
    const t = d.toString();
    try { appendLog(LOG, t); } catch {}
    diagnosticTail = (diagnosticTail + t).slice(-512);
    if (/SOCKS5 server listening/.test(diagnosticTail)) {
      state.connecting = false; state.connected = true; attempts = 0;
      connectedAt = Date.now(); startTelemetry(); emit();
    }
    if (/Client IP assigned/.test(diagnosticTail)) { state.clientIp = '已分配'; emit(); }
    const classifiedError = classifyEngineOutput(diagnosticTail, s.port);
    if (classifiedError) state.lastError = classifiedError;
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

function waitForConnected(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      if (state.connected) return resolve(true);
      if (userDisconnected || (!state.connecting && !engine && state.lastError)) {
        return resolve(false);
      }
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(poll, 100);
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
  if (/^(curl|wget|nc|node)$/.test(n)) return n;
  return n;
}
async function listTunnelApps(proxyPorts, enginePid, appPid) {
  const ports = new Set(proxyPorts.filter(
    (port) => Number.isInteger(port) && port >= 1 && port <= 65535
  ));
  if (!ports.size) return { connCount: 0, apps: [] };
  try {
    if (process.platform === 'win32') {
      const portFilter = [...ports].map((port) => `$_.RemotePort -eq ${port}`).join(' -or ');
      const ps = `$r=Get-NetTCPConnection -State Established -RemoteAddress 127.0.0.1 -EA SilentlyContinue|?{${portFilter}}|Group-Object OwningProcess|%{$p=Get-Process -Id $_.Name -EA SilentlyContinue;[pscustomobject]@{Pid=[int]$_.Name;Name=$p.ProcessName;Count=$_.Count}};$r|ConvertTo-Json -Compress`;
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
      const r = await listTunnelApps(
        [socksPort()],
        engine ? engine.pid : -1,
        process.pid,
      );
      lastTele.connCount = r.connCount; lastTele.apps = r.apps;
      if (tick % 2 === 0) lastTele.latencyMs = await tcpPing(gatewayIp, 443);
      if (tick % 4 === 0) await checkTunnelHealth();
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
  tunnelProbeFailures = 0;
}

async function checkTunnelHealth() {
  if (!state.connected || tunnelRecoveryInFlight) return;
  const probeOptions = {
    proxyPort: socksPort(),
    targetPort: 443,
    timeoutMs: 5000,
  };
  const first = await probeSocksConnect({
    ...probeOptions,
    targetHost: 'www.hkust-gz.edu.cn',
  });
  const second = first || await probeSocksConnect({
    ...probeOptions,
    targetHost: 'library.hkust-gz.edu.cn',
  });
  if (second) {
    tunnelProbeFailures = 0;
    return;
  }
  tunnelProbeFailures++;
  if (tunnelProbeFailures < 2 || loadSettings().autoReconnect === false) return;

  tunnelRecoveryInFlight = true;
  state.lastError = '校园隧道无响应，正在自动恢复…';
  emit();
  try {
    await reconnect();
  } finally {
    tunnelProbeFailures = 0;
    tunnelRecoveryInFlight = false;
  }
}

// ---------- PAC file (advanced app integration; no DNS probing) ----------
function refreshPacFile(settings = loadSettings()) {
  fs.writeFileSync(
    PAC_FILE,
    buildPac(settings.routeDomains, Number(settings.port)),
    { mode: 0o600 },
  );
  ensureOwnerOnly(PAC_FILE);
}
function pacUrl() { return pathToFileURL(PAC_FILE).href; }

function getCampusBrowser() {
  if (!campusBrowser) {
    const credentialVault = new CampusCredentialVault({
      filePath: CAMPUS_CREDENTIALS,
      safeStorage,
      platform: process.platform,
    });
    campusBrowser = new CampusBrowser({
      BrowserWindow,
      WebContentsView,
      session,
      dialog,
      credentialVault,
      parentWindow: () => win,
      toolbarFile: path.join(__dirname, 'renderer', 'campus-browser.html'),
      campusPreload: path.join(__dirname, 'campus-preload.js'),
      onError: (message) => {
        state.lastError = message;
        emit();
      },
    });
  }
  return campusBrowser;
}

async function connectAndOpenCampusBrowser(rawUrl) {
  let url;
  try {
    url = normalizeCampusUrl(rawUrl);
  } catch (error) {
    state.lastError = error.message;
    emit();
    return { ok: false, error: error.message };
  }

  if (!state.connected) {
    await connect();
    if (!await waitForConnected()) {
      const error = state.lastError || '连接校园网络超时，请重试或查看日志';
      state.lastError = error;
      emit();
      return { ok: false, error };
    }
  }

  try {
    await getCampusBrowser().open(url, socksPort());
    return { ok: true, url };
  } catch (error) {
    const message = `校园浏览器启动失败：${error.message}`;
    state.lastError = message;
    emit();
    return { ok: false, error: message };
  }
}

// ---------- IPC ----------
ipcMain.handle('get-state', () => ({
  ...state, connectedAt, settings: loadSettings(), hasPassword: hasPassword(), pacUrl: pacUrl(),
  loggedIn: hasPassword() && !!loadSettings().username, platform: process.platform,
  version: app.getVersion(), campusResources: loadCampusResources(),
}));
ipcMain.handle('save', async (_e, p) => {
  const previous = loadSettings();
  let next;
  let portChanged;
  try {
    ({ settings: next, portChanged } = applySettingsPatch(previous, p));
  } catch (error) {
    return { ok: false, error: error.message, settings: previous };
  }
  next = saveSettings(next);
  // The PAC file only serves external applications. A write failure must not
  // discard the settings that were already stored, nor the password below it.
  let pacError = null;
  try {
    refreshPacFile(next);
  } catch (error) {
    pacError = `设置已保存，但 PAC 文件写入失败：${error.message}`;
  }
  if (p && typeof p.password === 'string' && p.password.length && !savePassword(p.password)) {
    return { ok: false, error: '系统安全存储不可用，密码未保存' };
  }
  if (p && typeof p.startAtLogin === 'boolean') { try { app.setLoginItemSettings({ openAtLogin: p.startAtLogin }); } catch {} }
  let reconnected = false;
  if (engine && portChanged) {
    await reconnect();
    reconnected = true;
  }
  if (campusBrowser && portChanged) await campusBrowser.configure(next.port);
  if (pacError) {
    state.lastError = pacError;
    emit();
  }
  return {
    ok: true,
    warning: pacError,
    settings: next,
    portChanged,
    reconnected,
  };
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
  return readLogTail(LOG);
});
ipcMain.handle('open-log', () => shell.openPath(LOG));
ipcMain.handle('copy', (_e, text) => { clipboard.writeText(String(text || '')); return { ok: true }; });
ipcMain.handle('open-campus-browser', (_event, url) => connectAndOpenCampusBrowser(url));
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
  const image = loadTrayImage(nativeImage, path.join(__dirname, 'build', iconName), process.platform);
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
    width: 448,
    height: 680,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    title: 'HKUST(GZ) Connect',
    backgroundColor: '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      devTools: !app.isPackaged,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // The control window only ever renders its own bundled page. Deny popups and
  // navigation away from it so a future renderer change cannot turn it into a
  // browser with main-process privileges.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', handleWindowClose);
  win.on('closed', () => { win = null; });
}

function installApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'HKUST(GZ) Connect',
      submenu: [
        { role: 'about', label: '关于 HKUST(GZ) Connect' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 HKUST(GZ) Connect' },
        { role: 'hideOthers', label: '隐藏其他应用' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 HKUST(GZ) Connect' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
  ]));
}

app.on('second-instance', showWindow);
app.whenReady().then(() => {
  installApplicationMenu();
  // A PAC write can fail on a read-only or full user-data directory. That must
  // not leave the user with no window and no tray, so it is reported through the
  // normal error surface instead of aborting startup.
  try {
    refreshPacFile();
  } catch (error) {
    state.lastError = `无法写入 PAC 文件：${error.message}`;
  }
  createTray();
  createWindow();
  const settings = loadSettings();
  if (settings.autoConnect !== false && settings.username && hasPassword()) setTimeout(() => connect(), 500);
  app.on('activate', showWindow);
}).catch((error) => {
  dialog.showErrorBox('HKUST(GZ) Connect 启动失败', String(error && error.message ? error.message : error));
  app.exit(1);
});
app.on('window-all-closed', () => { /* Keep the tray process alive. */ });
app.on('before-quit', () => {
  isQuitting = true;
  disconnect();
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
});
