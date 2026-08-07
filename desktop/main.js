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
const {
  hasStoredPassword, loadPassword: readPassword, savePassword: writePassword,
} = require('./lib/credential-store');
const { resolveUserDataOverride } = require('./lib/app-data-dir');
const { classifyEngineOutput, engineFailureKind } = require('./lib/engine-output');
const { exactExecutablePattern } = require('./lib/engine-process');
const { buildPac } = require('./lib/pac');
const { CampusBrowser } = require('./lib/campus-browser');
const { loadCampusResources, mergeCampusResources } = require('./lib/campus-resources');
const { deleteCustomResource, reorderCustomResources, upsertCustomResource } = require('./lib/campus-resource-store');
const { normalizeOpenRequest, requiresCampusTunnel } = require('./lib/campus-open-policy');
const { ensureOwnerOnly } = require('./lib/private-file');
const { appendLog, readLogTail, resetLog } = require('./lib/secure-log');
const { planReconnect } = require('./lib/reconnect-policy');
const { stopPhase } = require('./lib/stop-policy');
const { loadTrayImage } = require('./lib/tray-icon');
const { AUTO_CHECK_INTERVAL_MS, checkForUpdate, isAllowedReleaseUrl, shouldAutoCheck } = require('./lib/update-check');
const { probeSocksConnect } = require('./lib/socks-health');
const {
  PROBE_TIMEOUT_MS, TELEMETRY_TICK_MS, shouldProbe, shouldRecover,
} = require('./lib/tunnel-health');
const { CampusCredentialVault } = require('./lib/campus-credential-vault');
const {
  MAX_CERTIFICATE_PINS, loadCertificateTrust, saveCertificateTrust,
} = require('./lib/campus-certificate-trust');
const { CONTROL_WINDOW, clampWindowSize } = require('./lib/window-layout');
const { createT, effectiveLocale } = require('./lib/i18n');

// ---------- profile override & single instance ----------
// Automated package checks need to isolate every app-owned file, not merely
// Chromium's cache. The override is deliberately private to the current
// process and must be absolute, so a relative launch cannot redirect it into
// an unexpected working directory.
const userDataOverride = resolveUserDataOverride(process.env.HKUSTGZ_USER_DATA_DIR);
if (userDataOverride) app.setPath('userData', userDataOverride);

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
const CAMPUS_CERTIFICATE_TRUST = path.join(DATA, 'campus-certificate-trust.json');
const GATEWAY_HOST = 'remote.hkust-gz.edu.cn';

for (const privateFile of [SETTINGS, CRED, LOG, PAC_FILE, CAMPUS_CREDENTIALS, CAMPUS_CERTIFICATE_TRUST]) {
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
let probeInFlight = false;
let lastTele = { connCount: 0, apps: [], latencyMs: null };
let state = { connected: false, connecting: false, clientIp: null, lastError: null, pacUrl: '' };
// Last known "newer release exists" result. Failures never land here, so the
// renderer can render it without distinguishing network errors from silence.
let updateInfo = null;
// UI locale follows the OS; Chinese stays the fallback until whenReady reads
// the real locale, so early failures still render a coherent language.
let locale = 'zh';
let t = createT(locale);

// ---------- settings & credentials ----------
function loadSettings() {
  return readSettings(SETTINGS);
}
// The saved language override ('zh'/'en') wins over the OS locale; 'auto'
// follows the system, and Chinese remains the fallback when both are silent.
function currentLocale() {
  return effectiveLocale(loadSettings().language, app.getLocale());
}
function saveSettings(settings) { return writeSettings(SETTINGS, settings); }
function savePassword(pw) {
  return writePassword(CRED, pw, safeStorage, process.platform);
}
function loadPassword() {
  return readPassword(CRED, safeStorage, process.platform);
}
function hasStoredCredential() { return hasStoredPassword(CRED, process.platform); }
function socksPort() { return Number(loadSettings().port) || 1080; }
function campusResources(settings = loadSettings()) {
  return mergeCampusResources(loadCampusResources(), settings.customResources);
}
function certificateIsTrusted(origin, fingerprint) {
  return loadCertificateTrust(CAMPUS_CERTIFICATE_TRUST).some((pin) =>
    pin.origin === origin && pin.fingerprint === fingerprint);
}
function trustCertificate(origin, fingerprint) {
  const current = loadCertificateTrust(CAMPUS_CERTIFICATE_TRUST)
    .filter((pin) => pin.origin !== origin);
  saveCertificateTrust(CAMPUS_CERTIFICATE_TRUST, [
    ...current.slice(-(MAX_CERTIFICATE_PINS - 1)),
    { origin, fingerprint },
  ]);
}

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
  // locale rides along so a language change reaches the renderer without a
  // separate channel; update rides along so an automatic check that finds a
  // new release surfaces without waiting for a full refresh. get-state stays
  // the source of truth on full refreshes.
  if (win && !win.isDestroyed()) {
    win.webContents.send('status', { ...state, connectedAt, locale, update: updateInfo });
  }
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
  if (!s.username || !pw) { state.connecting = false; state.lastError = t('error.needCredentials'); emit(); return; }
  state.connecting = true; state.connected = false; state.lastError = null; state.clientIp = null;
  emit();
  gatewayIp = GATEWAY_HOST;
  if (userDisconnected) { state.connecting = false; emit(); return; }
  try {
    // Keep every attempt in one diagnostic session. Clearing the file on an
    // automatic retry used to erase the failure that triggered that retry.
    if (!isRetry) resetLog(LOG);
    appendLog(LOG, `\n--- connection attempt ${attempts + 1} ---\n`);
  } catch {}
  const bin = enginePath();
  if (!fs.existsSync(bin)) { state.connecting = false; state.lastError = t('error.engineMissing', { path: bin }); emit(); return; }
  const engineConfig = engineConfigPath();
  if (!fs.existsSync(engineConfig)) { state.connecting = false; state.lastError = t('error.engineConfigMissing', { path: engineConfig }); emit(); return; }

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
    const chunk = d.toString();
    try { appendLog(LOG, chunk); } catch {}
    diagnosticTail = (diagnosticTail + chunk).slice(-512);
    if (/SOCKS5 server listening/.test(diagnosticTail)) {
      state.connecting = false; state.connected = true;
      state.lastError = null;
      connectedAt = Date.now(); startTelemetry(); emit();
    }
    if (/Client IP assigned/.test(diagnosticTail)) { state.clientIp = t('status.ipAssigned'); emit(); }
    const classifiedError = classifyEngineOutput(diagnosticTail, s.port, t);
    if (classifiedError) state.lastError = classifiedError;
  };
  engine.stdout.on('data', onData);
  engine.stderr.on('data', onData);
  engine.on('error', (err) => { state.connecting = false; state.lastError = t('error.engineStart', { message: err.message }); emit(); });
  engine.on('exit', (code) => {
    const wasConnected = state.connected;
    const uptime = connectedAt ? (Date.now() - connectedAt) : 0;
    engine = null;
    state.connected = false; state.clientIp = null; connectedAt = null;
    stopTelemetry();
    const failureKind = engineFailureKind(diagnosticTail);
    const terminalFailure = failureKind === 'terminal';
    const cfg = loadSettings();
    const autoOn = cfg.autoReconnect !== false;
    const maxA = Number.isInteger(cfg.maxAttempts) ? cfg.maxAttempts : MAX_ATTEMPTS;
    // user-initiated stop or bad credentials → never auto-reconnect
    if (userDisconnected || terminalFailure) { state.connecting = false; emit(); return; }
    // Only a genuinely stable session earns a fresh retry budget. Merely
    // opening SOCKS and then losing the data plane must keep counting, or a
    // rejecting gateway can drive the app into an infinite login loop.
    const retry = autoOn ? planReconnect({
      attempts,
      maxAttempts: maxA,
      wasConnected,
      uptimeMs: uptime,
      failureKind,
    }) : null;
    if (retry) {
      attempts = retry.attempt;
      state.connecting = true;
      state.lastError = wasConnected
        ? t('error.reconnecting')
        : (failureKind === 'gateway-transient'
          ? t('error.gatewayRetrying')
          : null);
      emit();
      setTimeout(() => connect(true), retry.delayMs);
      return;
    }
    state.connecting = false;
    if (failureKind === 'gateway-transient') {
      state.lastError = t('error.gatewayRejected');
    } else if (!state.lastError) {
      state.lastError = wasConnected
        ? t('error.reconnectFailed')
        : (code ? t('error.connectFailed') : null);
    }
    emit();
  });
}
function disconnect() { userDisconnected = true; connectedAt = null; stopTelemetry(); if (engine) engine.kill(); }

function forceStopEngine() {
  if (!engine) return;
  try { engine.kill('SIGKILL'); } catch {}
}

function waitForConnectionIdle() {
  const startedAt = Date.now();
  let forced = false;
  return new Promise((resolve) => {
    const poll = () => {
      if (!connectInFlight && !engine) return resolve(true);
      const phase = stopPhase(Date.now() - startedAt);
      if (phase === 'force' && !forced) {
        forced = true;
        forceStopEngine();
      }
      if (phase === 'failed') return resolve(false);
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
      state.lastError = t('error.engineStuck');
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
  if (/Code Helper/.test(n)) return 'VS Code';
  if (/Microsoft Edge|msedge/.test(n)) return 'Microsoft Edge';
  if (/Lark|Feishu|飞书/.test(n)) return 'Lark/飞书';
  if (/firefox/i.test(n)) return 'Firefox';
  if (n === 'ssh' || n === 'sshd') return 'SSH';
  if (/^(curl|wget|nc|node)$/.test(n)) return n;
  return n;
}
const processNames = new Map();
const MAX_TRACKED_PROCESS_NAMES = 256;
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
      // lsof truncates the command name, so the full one comes from ps. A pid
      // keeps the same name for its whole life, so resolve each one once instead
      // of spawning ps for every process on every telemetry tick.
      let name = processNames.get(p);
      if (name === undefined) {
        const full = (await run('ps', ['-p', String(p), '-o', 'comm='], 800)).trim();
        name = full ? full.split('/').pop() : (cmd.get(p) || String(p));
        if (processNames.size >= MAX_TRACKED_PROCESS_NAMES) processNames.clear();
        processNames.set(p, name);
      }
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
      if (shouldProbe(tick) && !probeInFlight) {
        probeInFlight = true;
        // Deliberately not awaited. The probe deadline is longer than the tick
        // interval and recovery is longer still, so awaiting it here would hold
        // `teleBusy` and freeze the live counters for the whole probe.
        checkTunnelHealth()
          .catch(() => {})
          .finally(() => { probeInFlight = false; });
      }
      sendTelemetry();
    } finally {
      // Advance even if a step above threw, otherwise the next pump repeats the
      // same tick and probes the tunnel again immediately.
      tick++;
      teleBusy = false;
    }
  };
  pump();
  telemetryTimer = setInterval(pump, TELEMETRY_TICK_MS);
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
    timeoutMs: PROBE_TIMEOUT_MS,
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
  if (!shouldRecover({
    failures: tunnelProbeFailures,
    autoReconnect: loadSettings().autoReconnect,
  })) return;

  tunnelRecoveryInFlight = true;
  state.lastError = t('error.tunnelRecovering');
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
      certificateTrust: {
        isTrusted: certificateIsTrusted,
        trust: trustCertificate,
      },
      credentialVault,
      parentWindow: () => win,
      toolbarFile: path.join(__dirname, 'renderer', 'campus-browser.html'),
      campusPreload: path.join(__dirname, 'campus-preload.js'),
      locale,
      t,
      onError: (message) => {
        state.lastError = message;
        emit();
      },
    });
  }
  return campusBrowser;
}

async function connectAndOpenCampusBrowser(rawUrl) {
  let request;
  try {
    request = normalizeOpenRequest(rawUrl, t);
  } catch (error) {
    state.lastError = error.message;
    emit();
    return { ok: false, error: error.message };
  }

  if (requiresCampusTunnel(request.route) && !state.connected) {
    await connect();
    if (!await waitForConnected()) {
      const error = state.lastError || t('error.connectTimeout');
      state.lastError = error;
      emit();
      return { ok: false, error };
    }
  }

  try {
    await getCampusBrowser().open(request.url, socksPort(), request.route);
    return { ok: true, url: request.url, route: request.route };
  } catch (error) {
    const message = t('error.browserStart', { message: error.message });
    state.lastError = message;
    emit();
    return { ok: false, error: message };
  }
}

// ---------- update check (notify only; no auto-download) ----------
// macOS builds are ad-hoc signed, so the app never downloads updates itself:
// it only learns whether a newer GitHub release exists and points the user at
// the release page. checkForUpdate resolves to null on any failure, so this
// can never throw into the main loop.
async function runUpdateCheck() {
  const result = await checkForUpdate(app.getVersion());
  if (result) {
    // The API answered, so the 24h throttle window starts here. Failures leave
    // the timestamp alone and are retried at the next launch.
    const settings = loadSettings();
    saveSettings({ ...settings, updateCheckedAt: Date.now() });
  }
  if (result && result.updateAvailable) {
    updateInfo = result;
    emit();
  }
  return result;
}

// Automatic checks run at most once every 24h (persisted across restarts and
// long-running sessions); the settings-page button always forces a fresh check.
function runAutomaticUpdateCheck() {
  if (!shouldAutoCheck(loadSettings().updateCheckedAt)) return Promise.resolve(null);
  return runUpdateCheck();
}

// ---------- IPC ----------
ipcMain.handle('get-state', () => {
  const settings = loadSettings();
  const passwordPresent = hasStoredCredential();
  return {
    ...state,
    connectedAt,
    settings,
    hasPassword: passwordPresent,
    pacUrl: pacUrl(),
    loggedIn: passwordPresent && !!settings.username,
    locale,
    platform: process.platform,
    version: app.getVersion(),
    update: updateInfo,
    campusResources: campusResources(settings),
  };
});
ipcMain.handle('save-resource', (_e, payload) => {
  const previous = loadSettings();
  try {
    const result = upsertCustomResource(previous.customResources, payload);
    saveSettings({ ...previous, customResources: result.resources });
    return { ok: true, resource: result.resource, resources: campusResources() };
  } catch (error) {
    return { ok: false, error: error.message, resources: campusResources(previous) };
  }
});
ipcMain.handle('delete-resource', (_e, id) => {
  const previous = loadSettings();
  try {
    const resources = deleteCustomResource(previous.customResources, id);
    saveSettings({ ...previous, customResources: resources });
    return { ok: true, resources: campusResources() };
  } catch (error) {
    return { ok: false, error: error.message, resources: campusResources(previous) };
  }
});
ipcMain.handle('reorder-resources', (_e, ids) => {
  const previous = loadSettings();
  const resources = reorderCustomResources(previous.customResources, ids);
  saveSettings({ ...previous, customResources: resources });
  return { ok: true, resources: campusResources() };
});
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
  // A language change applies immediately: recompute the effective locale,
  // re-render the tray, hand the campus browser the new strings, and let
  // emit() push the new locale to the control panel.
  if (next.language !== previous.language) {
    locale = effectiveLocale(next.language, app.getLocale());
    t = createT(locale);
    installApplicationMenu();
    if (campusBrowser) campusBrowser.setLocale(locale, t);
    emit();
  }
  // The PAC file only serves external applications. A write failure must not
  // discard the settings that were already stored, nor the password below it.
  let pacError = null;
  try {
    refreshPacFile(next);
  } catch (error) {
    pacError = t('error.pacWriteAfterSave', { message: error.message });
  }
  if (p && typeof p.password === 'string' && p.password.length && !savePassword(p.password)) {
    return { ok: false, error: t('error.passwordStoreUnavailable') };
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
ipcMain.handle('open-log', () => { shell.openPath(LOG).catch(() => {}); });
ipcMain.handle('copy', (_e, text) => { clipboard.writeText(String(text || '')); return { ok: true }; });
ipcMain.handle('open-campus-browser', (_event, url) => connectAndOpenCampusBrowser(url));
// Only an explicit button press forces a network check; entering the settings
// page goes through the same 24h throttle as the timer.
ipcMain.handle('check-update', (_event, force) => (
  force ? runUpdateCheck() : runAutomaticUpdateCheck()
));
ipcMain.handle('open-external', (_event, url) => {
  // The renderer may only send users to this project's GitHub releases pages.
  if (!isAllowedReleaseUrl(url)) return { ok: false };
  shell.openExternal(url).catch(() => {});
  return { ok: true };
});
ipcMain.handle('resize', (_e, h) => {
  if (win && !win.isDestroyed()) {
    const [w] = win.getContentSize();
    const next = clampWindowSize(w, h);
    win.setContentSize(next.width, next.height);
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
  const status = state.connecting
    ? t('status.connecting')
    : state.connected ? t('status.connected') : t('status.disconnected');
  tray.setToolTip(`HKUST(GZ) Connect - ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.showWindow'), click: showWindow },
    { label: t('tray.status', { status }), enabled: false },
    { type: 'separator' },
    {
      label: state.connected ? t('tray.disconnect') : t('tray.connect'),
      enabled: !state.connecting,
      click: () => { if (state.connected) disconnect(); else connect(); },
    },
    { label: t('tray.openCampusBrowser'), click: () => { connectAndOpenCampusBrowser(); } },
    { type: 'separator' },
    { label: t('tray.quit'), click: requestQuit },
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
      title: t('close.title'),
      message: t('close.message'),
      detail: t('close.detail'),
      buttons: [t('close.minimize'), t('close.quit'), t('close.cancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: t('close.remember'),
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
    ...CONTROL_WINDOW,
    resizable: true,
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
  const controlContents = win.webContents;
  controlContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  controlContents.on('will-navigate', (event, url) => {
    if (url !== controlContents.getURL()) event.preventDefault();
  });
  controlContents.on('will-attach-webview', (event) => event.preventDefault());
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
        { role: 'about', label: t('menu.about') },
        { type: 'separator' },
        { role: 'hide', label: t('menu.hide') },
        { role: 'hideOthers', label: t('menu.hideOthers') },
        { role: 'unhide', label: t('menu.unhide') },
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit') },
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') },
      ],
    },
    {
      label: t('menu.window'),
      submenu: [
        { role: 'minimize', label: t('menu.minimize') },
        { role: 'close', label: t('menu.closeWindow') },
      ],
    },
  ]));
}

app.on('second-instance', showWindow);
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // This exception path belongs only to untrusted pages rendered by the campus
  // browser. The control window, the toolbar, and every unrelated Electron
  // request retain Chromium's normal certificate handling.
  if (!campusBrowser?.ownsWebContents(webContents)) return;
  event.preventDefault();
  campusBrowser.handleCertificateError({ url, error, certificate, callback })
    .catch(() => callback(false));
});
app.whenReady().then(() => {
  locale = currentLocale();
  t = createT(locale);
  installApplicationMenu();
  // A PAC write can fail on a read-only or full user-data directory. That must
  // not leave the user with no window and no tray, so it is reported through the
  // normal error surface instead of aborting startup.
  try {
    refreshPacFile();
  } catch (error) {
    state.lastError = t('error.pacWriteAtBoot', { message: error.message });
  }
  createTray();
  createWindow();
  const settings = loadSettings();
  if (settings.autoConnect !== false && settings.username && hasStoredCredential()) {
    setTimeout(() => connect(), 500);
  }
  // Dev checkouts and CI would only ever hit the rate-limited API for no
  // benefit, so the automatic check is packaged-builds only. The settings
  // page can always trigger a manual one. Automatic checks are throttled to
  // once per 24h; the interval covers sessions that run for days.
  if (app.isPackaged) {
    setTimeout(() => { runAutomaticUpdateCheck().catch(() => {}); }, 5000);
    const updateTimer = setInterval(() => {
      runAutomaticUpdateCheck().catch(() => {});
    }, AUTO_CHECK_INTERVAL_MS);
    updateTimer.unref();
  }
  app.on('activate', showWindow);
}).catch((error) => {
  dialog.showErrorBox(t('error.startupTitle'), String(error && error.message ? error.message : error));
  app.exit(1);
});
app.on('window-all-closed', () => { /* Keep the tray process alive. */ });
app.on('before-quit', () => {
  isQuitting = true;
  disconnect();
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
});
