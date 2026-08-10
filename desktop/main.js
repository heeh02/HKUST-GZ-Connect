'use strict';
const {
  app, BrowserWindow, WebContentsView, ipcMain, shell, Menu, clipboard, safeStorage, session,
  Tray, nativeImage, dialog, powerMonitor, net: electronNet,
} = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('node:net');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { loadSettings: readSettings, saveSettings: writeSettings } = require('./lib/settings-store');
const { applySettingsPatch, parseCredentialField } = require('./lib/settings-update');
const {
  hasStoredPassword,
  loadPassword: readPassword,
  restorePasswordSnapshot,
  savePassword: writePassword,
} = require('./lib/credential-store');
const {
  recoverCredentialSettingsTransaction,
  runCredentialSettingsMutation,
} = require('./lib/credential-settings-transaction');
const { resolveUserDataOverride } = require('./lib/app-data-dir');
const {
  classifyEngineCode,
  classifyEngineOutput,
  classifyEngineStopReason,
  resolveEngineFailureKind,
} = require('./lib/engine-output');
const { EngineEventParser } = require('./lib/engine-protocol');
const { EngineControlClient } = require('./lib/engine-control-client');
const {
  ENGINE_HELLO_TIMEOUT_MS,
  EngineProtocolSession,
} = require('./lib/engine-protocol-session');
const { exactExecutablePattern } = require('./lib/engine-process');
const {
  EngineSupervisor,
  loadEngineOwnerRecord,
  removeEngineOwnerRecord,
  windowsOwnedEngineCleanupInvocation,
  writeEngineOwnerRecord,
} = require('./lib/engine-supervisor');
const { runConcurrentHealthRound } = require('./lib/health-supervisor');
const { buildPac } = require('./lib/pac');
const { DomainRoutePolicyStore } = require('./lib/domain-route-policy');
const { savePacFile } = require('./lib/pac-file');
const { pacDataUrl } = require('./lib/browser-session-manager');
const { CampusBrowser } = require('./lib/campus-browser');
const { AppConnectionEnumerator } = require('./lib/app-connection-enumerator');
const { loadCampusResources, mergeCampusResources } = require('./lib/campus-resources');
const { deleteCustomResource, reorderCustomResources, upsertCustomResource } = require('./lib/campus-resource-store');
const { normalizeOpenRequest } = require('./lib/campus-open-policy');
const { ensureOwnerOnly } = require('./lib/private-file');
const { BufferedLogWriter, readLogTail } = require('./lib/log-writer');
const { STOP_GRACE_MS, STOP_FORCE_WAIT_MS } = require('./lib/stop-policy');
const { loadTrayImage } = require('./lib/tray-icon');
const { AUTO_CHECK_INTERVAL_MS, checkForUpdate, isAllowedReleaseUrl, shouldAutoCheck } = require('./lib/update-check');
const { probeSocksConnect } = require('./lib/socks-health');
const { PROBE_TIMEOUT_MS, shouldRecover } = require('./lib/tunnel-health');
const { TelemetryService } = require('./lib/telemetry-service');
const { ConnectivityRecovery } = require('./lib/connectivity-recovery');
const { NetworkStatusMonitor } = require('./lib/network-status-monitor');
const { EphemeralProxyCredential } = require('./lib/proxy-credential');
const {
  ExternalProxyCredentialStore,
} = require('./lib/external-proxy-credential-store');
const {
  buildClashProxyYaml,
  buildSshProxyCommand,
  ensureProxyCredentialSidecar,
  externalProxyHelperPath,
} = require('./lib/external-proxy-config');
const { CampusCredentialVault } = require('./lib/campus-credential-vault');
const {
  CampusCertificateTrustStore,
} = require('./lib/campus-certificate-trust');
const { routeCertificateError } = require('./lib/certificate-error-boundary');
const { CONTROL_WINDOW, clampWindowSize } = require('./lib/window-layout');
const { createT, effectiveLocale } = require('./lib/i18n');
const { registerTrustedIpcHandlers } = require('./lib/ipc-handlers');
const { RoutingPolicyTransactionQueue } = require('./lib/routing-policy-transaction');
const { stopEngineAfterBrowserSuspend } = require('./lib/browser-engine-barrier');
const { ConnectionStateMachine } = require('./lib/connection-state-machine');
const {
  allowedKeys,
  boundedArray,
  boundedString,
  enumValue,
  plainObject,
} = require('./lib/ipc-guard');

// The campus browser is intentionally constrained to the application's
// proxy/PAC boundary. WebRTC data channels do not require camera or microphone
// permission and Chromium may otherwise send ICE/STUN UDP directly, bypassing
// that boundary and exposing local interfaces. This switch must be set before
// app.whenReady().
app.commandLine.appendSwitch(
  'force-webrtc-ip-handling-policy',
  'disable_non_proxied_udp',
);

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
const CAMPUS_BROWSER_PAC_FILE = path.join(DATA, 'campus-browser-routing.pac');
const ROUTING_RULES = path.join(DATA, 'routing-rules.json');
const CAMPUS_CREDENTIALS = path.join(DATA, 'campus-credentials.json');
const CAMPUS_CERTIFICATE_TRUST = path.join(DATA, 'campus-certificate-trust.json');
const ENGINE_OWNER = path.join(DATA, 'engine-owner.json');
const CREDENTIAL_TRANSACTION = path.join(DATA, 'credential-settings-transaction.json');
const PROXY_CREDENTIAL = path.join(DATA, 'proxy-credential.bin');
const PROXY_HELPER_CREDENTIAL = path.join(DATA, 'proxy-helper-credential.txt');
const GATEWAY_HOST = 'remote.hkust-gz.edu.cn';

// The helper sidecar is a short-lived, owner-only plaintext projection of the
// encrypted stable credential. It is valid only while this app owns (or is
// about to start) the loopback listener, so never carry it across launches.
try { fs.unlinkSync(PROXY_HELPER_CREDENTIAL); } catch (error) {
  if (error?.code !== 'ENOENT') {
    // A later strict connect/copy operation will fail closed if the path
    // cannot be safely replaced. Compatibility mode remains usable.
  }
}

const credentialTransactionPaths = Object.freeze({
  settings: SETTINGS,
  settingsBackup: `${SETTINGS}.bak`,
  credential: CRED,
});
// This must run before any loadSettings(), credential read, or blanket chmod.
// In particular, chmodding an attacker-replaced broad-permission journal
// first would erase the evidence that makes recovery fail closed.
let credentialTransactionRecovery = recoverCredentialSettingsTransaction(
  CREDENTIAL_TRANSACTION,
  credentialTransactionPaths,
);
let credentialTransactionBlocked = credentialTransactionRecovery.status === 'blocked';

for (const privateFile of [
  SETTINGS, CRED, LOG, PAC_FILE, CAMPUS_BROWSER_PAC_FILE, ROUTING_RULES,
  CAMPUS_CREDENTIALS, CAMPUS_CERTIFICATE_TRUST, ENGINE_OWNER,
  PROXY_CREDENTIAL, PROXY_HELPER_CREDENTIAL,
]) {
  ensureOwnerOnly(privateFile);
}

let win = null;
let tray = null;
let campusBrowser = null;
let isQuitting = false;
let quitAllowed = false;
let quitInFlight = null;
let closePromptOpen = false;
let connectInFlight = null;
let disconnectInFlight = null;
let reconnectInFlight = null;
const connectionState = new ConnectionStateMachine();
const MAX_ATTEMPTS = 3;
let connectedAt = null;
let gatewayIp = null;
let tunnelProbeFailures = 0;
let tunnelRecoveryInFlight = null;
let telemetryGeneration = null;
let activeProxyCredential = null;
let activeEngineControl = null;
let stableProxyCredential = null;
let lastTele = {
  connCount: 0,
  apps: [],
  latencyMs: null,
  tunnelHealth: 'unknown',
  failedHealthTargets: [],
};
let state = {
  connected: false,
  connecting: false,
  clientIp: null,
  dnsMode: 'unknown',
  lastError: null,
  notice: null,
  pacUrl: '',
};
const engineSupervisor = new EngineSupervisor({ spawnProcess: spawn });
const routingPolicyTransactions = new RoutingPolicyTransactionQueue();
const appConnectionEnumerator = new AppConnectionEnumerator();
const logWriter = new BufferedLogWriter(LOG);
const externalProxyCredentialStore = new ExternalProxyCredentialStore({
  filePath: PROXY_CREDENTIAL,
  safeStorage,
  platform: process.platform,
});
// Last known "newer release exists" result. Failures never land here, so the
// renderer can render it without distinguishing network errors from silence.
let updateInfo = null;
// UI locale follows the OS; Chinese stays the fallback until whenReady reads
// the real locale, so early failures still render a coherent language.
let locale = 'zh';
let t = createT(locale);
let settingsRecoveryNotice = null;
let settingsRecoveryNoticeText = null;
let settingsReadErrorText = null;
let credentialRecoveryNoticeText = null;
let credentialRecoveryErrorText = null;

// ---------- settings & credentials ----------
function loadSettings() {
  return readSettings(SETTINGS, {
    onRecovery: (notice) => { settingsRecoveryNotice = notice; },
  });
}
function reportSettingsReadFailure(cause, { emitState = true } = {}) {
  if (cause?.code === 'SETTINGS_READ_FAILED') return cause;
  const message = t('error.settingsReadFailed');
  const error = new Error(message, { cause });
  error.code = 'SETTINGS_READ_FAILED';
  error.userMessage = message;
  settingsReadErrorText = message;
  if (state.lastError !== message) {
    state.lastError = message;
    if (emitState) emit();
  }
  return error;
}
function loadSettingsOrReport(options) {
  try {
    const settings = loadSettings();
    if (settingsReadErrorText) {
      const shouldEmit = options?.emitState !== false && state.lastError === settingsReadErrorText;
      if (state.lastError === settingsReadErrorText) state.lastError = null;
      settingsReadErrorText = null;
      if (shouldEmit) emit();
    }
    return settings;
  }
  catch (error) { throw reportSettingsReadFailure(error, options); }
}
// The saved language override ('zh'/'en') wins over the OS locale; 'auto'
// follows the system, and Chinese remains the fallback when both are silent.
function currentLocale() {
  return effectiveLocale(loadSettings().language, app.getLocale());
}
function assertSettingsPersistenceAvailable() {
  // Never overwrite a settings snapshot that the credential transaction must
  // still restore. All settings/resource/routing writers pass this boundary,
  // so a blocked startup recovery is fail-closed for persistence as well as
  // for connection attempts.
  if (credentialTransactionBlocked) {
    const recovery = retryCredentialTransactionRecovery();
    if (recovery.status === 'blocked') {
      const message = t('error.credentialRecoveryBlocked');
      const error = new Error(message);
      error.code = 'CREDENTIAL_RECOVERY_BLOCKED';
      error.userMessage = message;
      throw error;
    }
  }
}
function saveSettings(settings) {
  assertSettingsPersistenceAvailable();
  return writeSettings(SETTINGS, settings);
}
function savePassword(pw) {
  return writePassword(CRED, pw, safeStorage, process.platform);
}
function loadPassword() {
  if (credentialTransactionBlocked) return '';
  return readPassword(CRED, safeStorage, process.platform);
}
function hasStoredCredential() {
  return !credentialTransactionBlocked && hasStoredPassword(CRED, process.platform);
}
function syncRecoveryNotice(emitState = true) {
  state.notice = [settingsRecoveryNoticeText, credentialRecoveryNoticeText]
    .filter(Boolean)
    .join('\n') || null;
  if (emitState) emit();
}
function applyCredentialRecoveryOutcome(recovery, {
  emitState = true,
  clearedNoticeKey = 'error.credentialRecoveryCleared',
  clearNotice = false,
} = {}) {
  credentialTransactionRecovery = recovery;
  const recoverySafe = recovery?.status === 'credential-cleared' || (
    recovery?.ok === true && ['none', 'recovered', 'committed'].includes(recovery.status)
  );
  credentialTransactionBlocked = !recoverySafe;

  if (credentialRecoveryErrorText && state.lastError === credentialRecoveryErrorText) {
    state.lastError = null;
  }
  credentialRecoveryErrorText = null;
  if (credentialTransactionBlocked) {
    credentialRecoveryNoticeText = null;
    credentialRecoveryErrorText = t('error.credentialRecoveryBlocked');
    state.lastError = credentialRecoveryErrorText;
  } else if (recovery?.status === 'recovered') {
    credentialRecoveryNoticeText = t('error.credentialRecoveryRecovered');
  } else if (recovery?.status === 'credential-cleared') {
    credentialRecoveryNoticeText = t(clearedNoticeKey);
  } else if (clearNotice) {
    credentialRecoveryNoticeText = null;
  }
  syncRecoveryNotice(emitState);
  return recovery;
}
function retryCredentialTransactionRecovery() {
  return applyCredentialRecoveryOutcome(recoverCredentialSettingsTransaction(
    CREDENTIAL_TRANSACTION,
    credentialTransactionPaths,
  ));
}
function socksPort() { return Number(loadSettingsOrReport().port) || 1080; }
function clearActiveProxyCredential(expectedGeneration = null) {
  if (!activeProxyCredential) return false;
  if (!activeProxyCredential.destroy(expectedGeneration)) return false;
  activeProxyCredential = null;
  return true;
}
function clearActiveEngineControl(expectedGeneration = null) {
  if (!activeEngineControl || (expectedGeneration !== null &&
      activeEngineControl.generation !== expectedGeneration)) return false;
  activeEngineControl.client.close();
  activeEngineControl = null;
  return true;
}
function requestActiveEngineControlShutdown() {
  const control = activeEngineControl;
  if (!control || !control.client.negotiated) return false;
  return control.client.shutdown().then(() => true);
}
function loadStableProxyCredential() {
  if (stableProxyCredential) return stableProxyCredential;
  stableProxyCredential = externalProxyCredentialStore.loadOrCreate();
  return stableProxyCredential;
}
function removeExternalProxySidecar() {
  try {
    fs.unlinkSync(PROXY_HELPER_CREDENTIAL);
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}
function ensureExternalProxyAccess(port) {
  const credential = loadStableProxyCredential();
  ensureProxyCredentialSidecar({
    filePath: PROXY_HELPER_CREDENTIAL,
    port,
    credential,
    platform: process.platform,
  });
  return credential;
}
function generationProxyCredential(port) {
  const stable = ensureExternalProxyAccess(port);
  const injected = stable.copyForEngine();
  try {
    return new EphemeralProxyCredential({ credential: injected });
  } finally {
    injected.username.fill(0);
    injected.password.fill(0);
  }
}
function proxyHelperPath() {
  return externalProxyHelperPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    desktopDir: __dirname,
    platform: process.platform,
    arch: process.arch,
  });
}
function campusResources(settings = loadSettingsOrReport()) {
  return mergeCampusResources(loadCampusResources(), settings.customResources);
}
function safeCampusResources(settings = null) {
  try { return campusResources(settings || loadSettingsOrReport()); }
  catch (error) {
    reportSettingsReadFailure(error);
    return mergeCampusResources(loadCampusResources(), []);
  }
}
const certificateTrustStore = new CampusCertificateTrustStore({
  filePath: CAMPUS_CERTIFICATE_TRUST,
});
function safeCertificatePins() {
  try { return certificateTrustStore.list(); }
  catch { return []; }
}

let serverCampusResources = [];
const domainRoutePolicy = new DomainRoutePolicyStore({
  filePath: ROUTING_RULES,
  customResources: () => loadSettingsOrReport().customResources,
  schoolDomains: () => loadSettingsOrReport().routeDomains,
  serverResources: () => serverCampusResources,
});
function safeRoutingRules() {
  try { return domainRoutePolicy.list(); }
  catch { return []; }
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
  if (process.platform === 'win32') {
    const owner = loadEngineOwnerRecord(ENGINE_OWNER);
    try {
      const invocation = windowsOwnedEngineCleanupInvocation(owner);
      if (!invocation) return;
      require('child_process').execFileSync(invocation.command, invocation.args, {
        env: invocation.env,
        stdio: 'ignore',
        timeout: 4000,
        windowsHide: true,
      });
    } catch {
    } finally {
      // A stale/corrupt record must not be retried forever. PID reuse is safe:
      // PowerShell checks both the recorded PID and the actual executable path.
      removeEngineOwnerRecord(ENGINE_OWNER);
    }
    return;
  }
  try {
    const processPattern = exactExecutablePattern(resolvedEnginePath);
    if (!processPattern) return;
    require('child_process').execFileSync(
      'pkill',
      ['-f', processPattern],
      { stdio: 'ignore', timeout: 3000 },
    );
  } catch {}
}

function beginLifecycleIntent() {
  // A manual connect/disconnect/reconnect always supersedes any recovery that
  // was queued for a previous sleep or network outage.
  connectivityRecovery.cancel();
  return connectionState.beginConnectIntent();
}

function invalidateForConnectivity(reason, intent) {
  if (!connectionState.pauseForConnectivity(intent, { isQuitting })) return;
  // Keep the lifecycle intent stable: resume/online is allowed to recover
  // this exact user-requested connection, while generation invalidation makes
  // every old engine event, retry, and health probe inert immediately.
  engineSupervisor.invalidate();
  connectedAt = null;
  state.connected = false;
  state.connecting = false;
  state.clientIp = null;
  state.dnsMode = 'unknown';
  state.lastError = t(reason === 'suspend'
    ? 'error.connectionSuspended'
    : 'error.networkUnavailable');
  stopTelemetry();
  emit();
  ensureEngineStopped().then((result) => {
    if (!connectionState.canContinue(intent) || result.ok) return;
    state.lastError = t('error.engineStuck');
    emit();
  }).catch(() => {});
}

async function recoverConnectivity(intent) {
  let autoReconnect;
  try {
    autoReconnect = loadSettingsOrReport().autoReconnect !== false;
  } catch {
    connectionState.failIntent(intent);
    state.connecting = false;
    return false;
  }
  if (!connectionState.canRecover(intent, { isQuitting, autoReconnect })) return false;
  const stopped = await ensureEngineStopped();
  if (!stopped.ok || !connectionState.canContinue(intent, { isQuitting })) {
    if (!stopped.ok && connectionState.isCurrentIntent(intent)) {
      state.lastError = t('error.engineStuck');
      emit();
    }
    return false;
  }
  if (!connectionState.resumeConnectivity(intent, { isQuitting, autoReconnect })) return false;
  const result = await connect(false, intent);
  return result.ok === true;
}

const connectivityRecovery = new ConnectivityRecovery({
  invalidate: invalidateForConnectivity,
  getLifecycleIntent: () => connectionState.currentRecoveryIntent({ isQuitting }),
  shouldReconnect: async (intent) => {
    try {
      return connectionState.canRecover(intent, {
        isQuitting,
        autoReconnect: loadSettingsOrReport().autoReconnect !== false,
      });
    } catch {
      connectionState.failIntent(intent);
      state.connecting = false;
      return false;
    }
  },
  reconnect: recoverConnectivity,
});

const networkStatusMonitor = new NetworkStatusMonitor({
  isOnline: () => electronNet.isOnline(),
  onOffline: () => connectivityRecovery.networkOffline(),
  onOnline: () => connectivityRecovery.networkOnline(),
});

async function connect(isRetry = false, expectedIntent = null) {
  const intent = expectedIntent === null
    ? (isRetry ? connectionState.snapshot().intent : beginLifecycleIntent())
    : expectedIntent;
  if (!connectionState.canContinue(intent)) return { ok: false, stale: true };

  // A connect requested while an earlier stop is draining waits for close;
  // it never starts a second process into the exit/close interval.
  if (disconnectInFlight) await disconnectInFlight;
  if (!connectionState.canContinue(intent)) return { ok: false, stale: true };
  if (engineSupervisor.hasActive) return { ok: true, existing: true };
  if (connectInFlight) {
    await connectInFlight;
    if (!connectionState.canContinue(intent)) return { ok: false, stale: true };
    if (engineSupervisor.hasActive) return { ok: true, existing: true };
  }

  const operation = connectOnce(isRetry, intent);
  connectInFlight = operation;
  try { return await operation; }
  finally { if (connectInFlight === operation) connectInFlight = null; }
}

function handleEngineClose({ code, generation }, diagnosticTail,
  structuredFatalCode = null, structuredStopReason = null, stoppedSocksPort = 1080) {
  // A delayed close from an already invalidated generation must not suspend a
  // newer listener that is now serving the browser.
  const supervisorGenerationCurrent = engineSupervisor.isCurrent(generation);
  clearActiveEngineControl(generation);
  clearActiveProxyCredential(generation);
  removeExternalProxySidecar();
  if (!supervisorGenerationCurrent || !connectionState.isCurrentGeneration(generation)) return;
  // Unexpected process death releases the configured loopback port before the
  // close event reaches JavaScript. Repoint the persistent browser Session at
  // its fail-closed PAC immediately; a later generation may restore it only
  // after reporting listener_ready.
  suspendOpenBrowserPolicy().catch((error) => {
    state.lastError = t('error.browserRoutingAfterSave', { message: error.message });
    emit();
  });

  const wasConnected = state.connected;
  const uptime = connectedAt ? (Date.now() - connectedAt) : 0;
  state.connected = false;
  state.clientIp = null;
  state.dnsMode = 'unknown';
  connectedAt = null;
  stopTelemetry();
  const failureKind = resolveEngineFailureKind({
    code: structuredFatalCode,
    stopReason: structuredStopReason,
    diagnosticText: diagnosticTail,
  });
  const terminalFailure = failureKind === 'terminal';
  if (!structuredFatalCode && !state.lastError) {
    state.lastError = classifyEngineStopReason(structuredStopReason, stoppedSocksPort, t);
  }
  let cfg;
  try {
    cfg = loadSettings();
  } catch (error) {
    connectionState.engineClosed({
      generation,
      supervisorGenerationCurrent,
      terminalFailure: true,
    });
    state.connecting = false;
    state.lastError = reportSettingsReadFailure(error, { emitState: false }).message;
    emit();
    return;
  }
  const autoOn = cfg.autoReconnect !== false;
  const maxA = Number.isInteger(cfg.maxAttempts) ? cfg.maxAttempts : MAX_ATTEMPTS;
  const decision = connectionState.engineClosed({
    generation,
    supervisorGenerationCurrent,
    terminalFailure,
    autoReconnect: autoOn,
    maxAttempts: maxA,
    wasConnected,
    uptimeMs: uptime,
    failureKind,
  });

  if (decision.action === 'settled' || decision.action === 'terminal') {
    state.connecting = false;
    emit();
    return;
  }

  // Only a genuinely stable session earns a fresh retry budget. Merely
  // opening SOCKS and then losing the data plane must keep counting, or a
  // rejecting gateway can drive the app into an infinite login loop.
  if (decision.action === 'retry') {
    state.connecting = true;
    state.lastError = wasConnected
      ? t('error.reconnecting')
      : (failureKind === 'gateway-transient'
        ? t('error.gatewayRetrying')
        : null);
    emit();
    const intent = connectionState.snapshot().intent;
    engineSupervisor.schedule(generation, decision.delayMs, () => connect(true, intent));
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
}

function handleEngineExitBoundary({ generation }) {
  // `exit` means the process has already released its loopback listener even
  // though Node may not emit `close` until stdout/stderr drain. Close the
  // in-process browser request gate synchronously in that interval so another
  // local process cannot bind the configured port and impersonate the proxy.
  if (!engineSupervisor.isCurrent(generation) ||
      !connectionState.isCurrentGeneration(generation)) return;
  clearActiveEngineControl(generation);
  clearActiveProxyCredential(generation);
  removeExternalProxySidecar();
  suspendOpenBrowserPolicy().catch((error) => {
    state.lastError = t('error.browserRoutingAfterSave', { message: error.message });
    emit();
  });
}

async function connectOnce(isRetry, intent) {
  if (engineSupervisor.hasActive || !connectionState.canContinue(intent)) {
    return { ok: false, stale: true };
  }
  if (!connectionState.beginConnectAttempt(intent, { isRetry })) {
    return { ok: false, stale: true };
  }
  if (credentialTransactionBlocked) {
    const recovery = retryCredentialTransactionRecovery();
    if (recovery.status === 'blocked') {
      connectionState.failIntent(intent);
      state.connecting = false;
      state.lastError = t('error.credentialRecoveryBlocked');
      emit();
      return { ok: false, blocked: true };
    }
  }
  let s;
  let pw;
  state.connecting = true;
  state.connected = false;
  state.lastError = null;
  state.clientIp = null;
  state.dnsMode = 'unknown';
  emit();
  gatewayIp = GATEWAY_HOST;
  if (!connectionState.canAttempt(intent)) {
    state.connecting = false;
    emit();
    return { ok: false, stale: true };
  }
  try {
    // Keep every attempt in one diagnostic session. Clearing the file on an
    // automatic retry used to erase the failure that triggered that retry.
    if (!isRetry) await logWriter.reset();
    logWriter.append(`\n--- connection attempt ${connectionState.snapshot().attemptNumber} ---\n`);
  } catch {}
  if (!connectionState.canAttempt(intent)) {
    state.connecting = false;
    emit();
    return { ok: false, stale: true };
  }
  if (credentialTransactionBlocked) {
    const recovery = retryCredentialTransactionRecovery();
    if (recovery.status === 'blocked') {
      connectionState.failIntent(intent);
      state.connecting = false;
      state.lastError = t('error.credentialRecoveryBlocked');
      emit();
      return { ok: false, blocked: true };
    }
  }
  // FINAL_CONNECTION_SNAPSHOT: log reset above is connectOnce's last async yield
  // before spawn. Re-read the matching settings/credential pair now, then keep
  // the path through EngineSupervisor.start() and stdin synchronous. A settings
  // save during log I/O therefore either lands in this snapshot, or runs after
  // the child is active and follows the normal reconnect path.
  try {
    s = loadSettings();
    pw = loadPassword();
  } catch (error) {
    connectionState.failIntent(intent);
    state.connecting = false;
    state.lastError = reportSettingsReadFailure(error, { emitState: false }).message;
    emit();
    return { ok: false, settingsUnavailable: true };
  }
  if (!s.username || !pw) {
    connectionState.failIntent(intent);
    state.connecting = false;
    state.lastError = t('error.needCredentials');
    emit();
    return { ok: false };
  }
  try {
    if (s.username.length > 256 || pw.length > 4096) throw new Error('credential too long');
    parseCredentialField(s.username, '账号');
    parseCredentialField(pw, '密码');
  } catch {
    pw = '';
    connectionState.failIntent(intent);
    state.connecting = false;
    state.lastError = t('error.invalidStoredCredentials');
    emit();
    return { ok: false, invalidCredentials: true };
  }
  const bin = enginePath();
  if (!fs.existsSync(bin)) {
    connectionState.failIntent(intent);
    state.connecting = false;
    state.lastError = t('error.engineMissing', { path: bin });
    emit();
    return { ok: false };
  }
  const engineConfig = engineConfigPath();
  if (!fs.existsSync(engineConfig)) {
    connectionState.failIntent(intent);
    state.connecting = false;
    state.lastError = t('error.engineConfigMissing', { path: engineConfig });
    emit();
    return { ok: false };
  }

  clearActiveProxyCredential();
  let proxyCredential = null;
  let proxyCredentialMode = 'none';
  if (s.strictProxyAuth === true) {
    try {
      proxyCredential = generationProxyCredential(Number(s.port));
      proxyCredentialMode = 'required';
    } catch {
      connectionState.failIntent(intent);
      state.connecting = false;
      state.lastError = t('error.proxyCredentialUnavailable');
      emit();
      return { ok: false };
    }
  } else if (stableProxyCredential || fs.existsSync(PROXY_CREDENTIAL)) {
    // The packaged SSH helper reads its endpoint from the sidecar and offers
    // both NO_AUTH and RFC1929, so one copied ProxyCommand keeps working when
    // the user later changes port or toggles strict mode. Do not create this
    // optional credential for ordinary compatibility-mode users who have
    // never requested an external configuration; that avoids unnecessary OS
    // secure-storage access. Failure never blocks the core tunnel itself.
    try {
      proxyCredential = generationProxyCredential(Number(s.port));
      proxyCredentialMode = 'optional';
    } catch {}
  }

  let resolvedBin;
  try { resolvedBin = fs.realpathSync(bin); } catch { resolvedBin = path.resolve(bin); }
  killStrayEngines(resolvedBin); // gateway = one session per account; clear this app's orphan only
  let diagnosticTail = '';
  let engineGeneration = null;
  let ownedEngine = null;
  let structuredFatalCode = null;
  let protocolSession = null;
  let protocolHelloTimer = null;
  connectionState.invalidateEngineGeneration();
  const expectedEngineGeneration = engineSupervisor.currentGeneration + 1;
  const engineArgs = [
    '--config', engineConfig,
    '--credentials-stdin',
    '--socks-bind', `127.0.0.1:${Number(s.port)}`,
    '--generation', String(expectedEngineGeneration),
    '--control-api-v2-stdin',
  ];
  if (proxyCredentialMode === 'required') engineArgs.push('--socks-auth-stdin');
  if (proxyCredentialMode === 'optional') engineArgs.push('--socks-auth-optional-stdin');
  const started = engineSupervisor.start({
    command: bin,
    args: engineArgs,
    options: { stdio: ['pipe', 'pipe', 'pipe'] },
    onError: ({ error, generation }) => {
      if (!engineSupervisor.isCurrent(generation)) return;
      structuredFatalCode = 'EVENT_OUTPUT_FAILED';
      state.connecting = false;
      state.lastError = t('error.engineStart', { message: error.message });
      emit();
    },
    onExit: handleEngineExitBoundary,
    onClose: (result) => {
      if (protocolHelloTimer) clearTimeout(protocolHelloTimer);
      if (ownedEngine) removeEngineOwnerRecord(ENGINE_OWNER, ownedEngine);
      handleEngineClose(
        result,
        diagnosticTail,
        structuredFatalCode,
        protocolSession?.stoppedReason || null,
        Number(s.port),
      );
    },
  });
  if (!started.ok) {
    proxyCredential?.destroy();
    removeExternalProxySidecar();
    if (started.reason === 'spawn') {
      connectionState.failIntent(intent);
      state.connecting = false;
      state.lastError = t('error.engineStart', { message: started.error.message });
      emit();
    }
    return { ok: false, error: started.error };
  }
  const child = started.child;
  engineGeneration = started.generation;
  connectionState.bindEngineGeneration(engineGeneration);
  if (engineGeneration !== expectedEngineGeneration) {
    proxyCredential?.destroy();
    removeExternalProxySidecar();
    structuredFatalCode = 'EVENT_OUTPUT_FAILED';
    state.lastError = classifyEngineCode(structuredFatalCode, s.port, t);
    emit();
    await engineSupervisor.stop({ graceMs: 0, forceWaitMs: STOP_FORCE_WAIT_MS });
    return { ok: false };
  }
  protocolSession = new EngineProtocolSession(engineGeneration);
  const engineControlClient = new EngineControlClient({ writable: child.stdin });
  activeEngineControl = { generation: engineGeneration, client: engineControlClient };
  if (proxyCredential) {
    if (!proxyCredential.bindGeneration(engineGeneration, Number(s.port))) {
      proxyCredential.destroy();
      removeExternalProxySidecar();
      structuredFatalCode = 'EVENT_OUTPUT_FAILED';
      state.lastError = t('error.proxyCredentialUnavailable');
      emit();
      await engineSupervisor.stop({ graceMs: 0, forceWaitMs: STOP_FORCE_WAIT_MS });
      return { ok: false };
    }
    activeProxyCredential = proxyCredential;
  }
  if (process.platform === 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
    ownedEngine = { pid: child.pid, executablePath: resolvedBin };
    try { writeEngineOwnerRecord(ENGINE_OWNER, ownedEngine); } catch {}
  }
  // An engine that dies before reading stdin (missing library, wrong
  // architecture) makes this write emit EPIPE. Without a listener that would
  // become an uncaught exception and take the whole application down, so the
  // failure is left to the supervisor's final close handler instead.
  child.stdin.on('error', () => {});
  let proxyCredentialLines = proxyCredential
    ? proxyCredential.stdinSuffix(engineGeneration)
    : '';
  // Control API v2 reuses this inherited private pipe after the fixed two- or
  // four-line credential prefix. Keep stdin open: closing it disables only
  // the optional control plane, while credentials and control frames remain
  // distinct bounded parsers in the engine.
  child.stdin.write(`${s.username}\n${pw}\n${proxyCredentialLines}`);
  pw = '';
  proxyCredentialLines = '';
  const eventParser = new EngineEventParser();
  let listenerReady = false;
  let browserActivationInFlight = null;
  let controlHandshakeStarted = false;

  const startControlHandshake = () => {
    if (controlHandshakeStarted || !engineSupervisor.isCurrent(engineGeneration)) return;
    controlHandshakeStarted = true;
    // The engine intentionally begins consuming control actions only after
    // authentication and L3 setup. A failed optional handshake must not tear
    // down an otherwise healthy tunnel; stop retains the bounded SIGTERM
    // fallback when v2 is unavailable.
    engineControlClient.handshake().catch(() => {});
  };

  const finishConnected = () => {
    if (!engineSupervisor.isCurrent(engineGeneration) || listenerReady === false ||
        !connectionState.markConnected(engineGeneration)) return;
    const wasConnected = state.connected;
    state.connecting = false;
    state.connected = true;
    state.lastError = null;
    if (!wasConnected) {
      connectedAt = Date.now();
      startTelemetry(engineGeneration);
    }
    emit();
  };

  const markConnected = () => {
    if (!engineSupervisor.isCurrent(engineGeneration) || listenerReady === false) return;
    if (!campusBrowser?.routingSuspended) {
      finishConnected();
      return;
    }
    if (browserActivationInFlight) return;
    const activation = campusBrowser.resumeRoutingPolicy(Number(s.port));
    browserActivationInFlight = activation;
    activation.then(() => {
      if (browserActivationInFlight === activation) browserActivationInFlight = null;
      finishConnected();
    }).catch((error) => {
      if (browserActivationInFlight === activation) browserActivationInFlight = null;
      if (!engineSupervisor.isCurrent(engineGeneration)) return;
      // The engine is usable by authenticated external clients, while the
      // built-in browser deliberately remains behind its request gate.
      finishConnected();
      state.lastError = t('error.browserRoutingAfterSave', { message: error.message });
      emit();
    });
  };

  const applyHumanDiagnostic = (chunk) => {
    diagnosticTail = (diagnosticTail + chunk).slice(-512);
    if (!engineSupervisor.isCurrent(engineGeneration)) return;
    const classifiedError = classifyEngineOutput(diagnosticTail, s.port, t);
    if (classifiedError) {
      state.lastError = classifiedError;
      emit();
    }
  };

  const applyEngineEvent = (event) => {
    if (!engineSupervisor.isCurrent(engineGeneration) || !protocolSession.accept(event)) return;
    switch (event.type) {
      case 'hello':
        if (protocolHelloTimer) clearTimeout(protocolHelloTimer);
        protocolHelloTimer = null;
        break;
      case 'state_changed':
        if (event.state === 'connecting' || event.state === 'authenticating') {
          if (!connectionState.markConnecting(engineGeneration)) break;
          state.connecting = true;
          emit();
        } else if (event.state === 'connected') {
          markConnected();
        }
        break;
      case 'listener_ready':
        if (event.port !== Number(s.port)) {
          structuredFatalCode = 'LOCAL_LISTENER_FAILED';
          state.lastError = classifyEngineCode(structuredFatalCode, s.port, t);
          emit();
          break;
        }
        listenerReady = true;
        startControlHandshake();
        markConnected();
        break;
      case 'client_ip_assigned':
        state.clientIp = t('status.ipAssigned');
        emit();
        break;
      case 'dns_mode':
        state.dnsMode = event.mode;
        emit();
        break;
      case 'network_unhealthy':
        state.lastError = t('error.tunnelRecovering');
        emit();
        break;
      case 'fatal_error':
        structuredFatalCode = event.code;
        state.lastError = classifyEngineCode(event.code, s.port, t);
        emit();
        break;
      case 'stopped':
        // EngineProtocolSession retains the generation-bound reason for the
        // authoritative process close boundary.
        break;
      default:
        break;
    }
  };

  protocolHelloTimer = setTimeout(() => {
    if (protocolSession.helloSeen || !engineSupervisor.isCurrent(engineGeneration)) return;
    structuredFatalCode = 'EVENT_OUTPUT_FAILED';
    state.connecting = false;
    state.lastError = classifyEngineCode(structuredFatalCode, s.port, t);
    emit();
    engineSupervisor.stop({ graceMs: 1000, forceWaitMs: STOP_FORCE_WAIT_MS }).catch(() => {});
  }, ENGINE_HELLO_TIMEOUT_MS);
  protocolHelloTimer.unref?.();

  child.stdout.on('data', (data) => {
    engineControlClient.feed(data);
    const events = eventParser.feed(data);
    for (const event of events) applyEngineEvent(event);
  });
  child.stderr.on('data', (data) => {
    const chunk = data.toString();
    logWriter.append(chunk);
    applyHumanDiagnostic(chunk);
  });
  return { ok: true, generation: engineGeneration };
}

function ensureEngineStopped() {
  if (disconnectInFlight) return disconnectInFlight;
  // Establish the browser barrier before the engine releases its listener;
  // otherwise another local account/process can bind the now-free port and
  // impersonate the expected proxy. The synchronous request gate is the hard
  // boundary: PAC/drain failures are surfaced but do not strand the engine.
  const operation = stopEngineAfterBrowserSuspend({
    suspendBrowser: suspendOpenBrowserPolicy,
    browserBoundaryClosed: () => campusBrowser?.routingRequestsBlocked !== false,
    closeBrowser: () => campusBrowser?.close(),
    onSuspendError: (error) => {
      state.lastError = t('error.browserRoutingAfterSave', { message: error.message });
      emit();
    },
    stopEngine: () => engineSupervisor.stop({
      requestGracefulStop: requestActiveEngineControlShutdown,
      graceMs: STOP_GRACE_MS,
      forceWaitMs: STOP_FORCE_WAIT_MS,
    }),
  });
  disconnectInFlight = operation;
  operation.finally(() => {
    // The encrypted master remains stable, but the plaintext helper projection
    // must not outlive the listener. Reconnect/resume recreates it before the
    // next engine starts, including after a port change.
    removeExternalProxySidecar();
    if (disconnectInFlight === operation) disconnectInFlight = null;
  });
  return operation;
}

function initiateStop(wantsConnectedAfterStop) {
  connectivityRecovery.cancel();
  const intent = connectionState.beginStop(wantsConnectedAfterStop);
  // Generation invalidation happens before waiting for close. Old probes,
  // delayed retries, and output callbacks are stale from this exact point.
  engineSupervisor.invalidate();
  clearActiveProxyCredential();
  connectedAt = null;
  state.connected = false;
  state.connecting = false;
  state.clientIp = null;
  state.dnsMode = 'unknown';
  stopTelemetry();
  emit();
  return { intent, stopped: ensureEngineStopped() };
}

async function disconnect() {
  const { intent, stopped } = initiateStop(false);
  const result = await stopped;
  removeExternalProxySidecar();
  connectionState.stopCompleted(intent, result);
  if (connectionState.isCurrentIntent(intent) && !result.ok) {
    state.lastError = t('error.engineStuck');
    emit();
  }
  return { ok: result.ok };
}

function waitForConnected(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      if (state.connected) return resolve(true);
      if (connectionState.shouldStopWaiting({
        connecting: state.connecting,
        hasActive: engineSupervisor.hasActive,
        lastError: state.lastError,
      })) {
        return resolve(false);
      }
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(poll, 100);
    };
    poll();
  });
}

async function reconnect(expectedGeneration = null) {
  if (expectedGeneration !== null && !engineSupervisor.isCurrent(expectedGeneration)) {
    return { ok: false, stale: true };
  }
  if (reconnectInFlight && connectionState.isCurrentIntent(reconnectInFlight.intent) &&
      connectionState.snapshot().desiredConnected) {
    return reconnectInFlight.promise;
  }
  if (reconnectInFlight) await reconnectInFlight.promise;
  if (expectedGeneration !== null && !engineSupervisor.isCurrent(expectedGeneration)) {
    return { ok: false, stale: true };
  }

  const { intent, stopped } = initiateStop(true);
  const operation = (async () => {
    const stopResult = await stopped;
    connectionState.stopCompleted(intent, stopResult);
    if (!stopResult.ok) {
      state.connecting = false;
      state.lastError = t('error.engineStuck');
      emit();
      return { ok: false };
    }
    if (!connectionState.resumeAfterStop(intent)) return { ok: false, stale: true };
    return connect(false, intent);
  })();
  const record = { intent, promise: operation };
  reconnectInFlight = record;
  try { return await operation; }
  finally { if (reconnectInFlight === record) reconnectInFlight = null; }
}

// ---------- telemetry: latency + which apps use the SOCKS tunnel ----------
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
function sendTelemetry(snapshot = lastTele) {
  lastTele = snapshot;
  if (!win || win.isDestroyed()) return;
  win.webContents.send('telemetry', { connectedAt, ...lastTele });
}

const telemetryService = new TelemetryService({
  collectApps: () => appConnectionEnumerator.list({
    ports: [socksPort()],
    enginePid: engineSupervisor.currentChild?.pid ?? -1,
    appPid: process.pid,
  }),
  collectLatency: () => tcpPing(gatewayIp, 443),
  collectHealth: (generation) => checkTunnelHealth(generation),
  emit: (snapshot, generation) => {
    if (state.connected && engineSupervisor.isCurrent(generation) &&
        telemetryGeneration === generation) sendTelemetry(snapshot);
  },
  isVisible: () => Boolean(win && !win.isDestroyed() && win.isVisible()),
  isGenerationCurrent: (generation) => (
    state.connected && engineSupervisor.isCurrent(generation) && telemetryGeneration === generation
  ),
});

function startTelemetry(generation) {
  stopTelemetry();
  telemetryGeneration = generation;
  telemetryService.start(generation);
}
function stopTelemetry() {
  telemetryGeneration = null;
  telemetryService.stop();
  lastTele = {
    connCount: 0,
    apps: [],
    latencyMs: null,
    tunnelHealth: 'unknown',
    failedHealthTargets: [],
  };
  tunnelProbeFailures = 0;
}

async function checkTunnelHealth(generation) {
  if (!state.connected || !engineSupervisor.isCurrent(generation) ||
      (tunnelRecoveryInFlight && tunnelRecoveryInFlight.generation === generation)) return;
  let proxyPort;
  try {
    proxyPort = Number(loadSettingsOrReport().port);
  } catch {
    return { kind: 'settings-unavailable', failedTargets: [] };
  }
  const result = await runConcurrentHealthRound({
    generation,
    isGenerationCurrent: (candidate) => (
      engineSupervisor.isCurrent(candidate) && telemetryGeneration === candidate
    ),
    probe: probeSocksConnect,
    proxyPort,
    proxyCredentials: activeProxyCredential?.socksAuthentication(generation) || null,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (result.kind === 'stale') return result;

  // One successful independent target proves that the SOCKS/data plane is
  // alive. Report the other as a site failure without consuming the tunnel's
  // recovery budget.
  if (result.kind === 'healthy' || result.kind === 'site-failure') {
    tunnelProbeFailures = 0;
    return result;
  }
  tunnelProbeFailures++;
  let autoReconnect;
  try {
    autoReconnect = loadSettingsOrReport().autoReconnect;
  } catch {
    return { ...result, kind: 'settings-unavailable' };
  }
  if (!shouldRecover({
    failures: tunnelProbeFailures,
    autoReconnect,
  })) {
    return result;
  }
  if (!engineSupervisor.isCurrent(generation) ||
      !connectionState.snapshot().desiredConnected) {
    return { ...result, kind: 'stale' };
  }

  const recoveryRecord = { generation };
  tunnelRecoveryInFlight = recoveryRecord;
  state.lastError = t('error.tunnelRecovering');
  emit();
  try {
    await reconnect(generation);
  } finally {
    if (tunnelRecoveryInFlight === recoveryRecord) {
      tunnelProbeFailures = 0;
      tunnelRecoveryInFlight = null;
    }
  }
  return result;
}

// ---------- PAC file (advanced app integration; no DNS probing) ----------
let currentPacUrl = pathToFileURL(PAC_FILE).href;
function refreshPacFile(settings = loadSettingsOrReport()) {
  const saved = savePacFile(PAC_FILE, buildPac(
    settings.routeDomains,
    Number(settings.port),
    domainRoutePolicy.options(),
  ));
  currentPacUrl = saved.url;
  return saved;
}
function pacUrl() { return currentPacUrl; }

function browserPolicyProxyConfig(port) {
  const proxyKind = loadSettingsOrReport().strictProxyAuth === true ? 'http' : 'socks5';
  const source = domainRoutePolicy.buildPac(
    Number(port),
    { proxyKind, campusPrivateIpv4: true },
  );
  // Keep a durable diagnostic copy, while Chromium consumes an in-memory PAC.
  // If the derived file disappears or cannot be re-read, Chromium must never
  // silently fall back to DIRECT for a campus page.
  savePacFile(
    CAMPUS_BROWSER_PAC_FILE,
    source,
  );
  return {
    mode: 'pac_script',
    pacScript: pacDataUrl(source),
    proxyBypassRules: '<-loopback>',
  };
}

async function suspendOpenBrowserPolicy() {
  if (!campusBrowser) return null;
  return campusBrowser.suspendRoutingPolicy();
}

async function resumeOpenBrowserPolicyIfLive() {
  if (!campusBrowser || !state.connected || !engineSupervisor.hasActive) return null;
  return campusBrowser.resumeRoutingPolicy(socksPort());
}

function runDomainPolicyTransaction(buildOperations) {
  return routingPolicyTransactions.run(() => {
    assertSettingsPersistenceAvailable();
    const { commit, rollback, resumeBrowser = true } = buildOperations();
    return {
      suspend: suspendOpenBrowserPolicy,
      commit,
      applyExternal: () => refreshPacFile(loadSettingsOrReport()),
      applyBrowser: resumeBrowser ? resumeOpenBrowserPolicyIfLive : null,
      rollback,
      restoreExternal: () => refreshPacFile(loadSettingsOrReport()),
      restoreBrowser: resumeOpenBrowserPolicyIfLive,
    };
  });
}

const browserRoutingPolicy = {
  appliesLiveSession: true,
  list: () => domainRoutePolicy.list(),
  resolve: (url, inheritedRoute) => domainRoutePolicy.resolve(url, inheritedRoute),
  upsert: (payload) => runDomainPolicyTransaction(() => {
    const previousRules = domainRoutePolicy.list();
    return {
      commit: () => domainRoutePolicy.upsert(payload),
      rollback: () => domainRoutePolicy.replace(previousRules),
    };
  }),
  remove: (payload) => runDomainPolicyTransaction(() => {
    const previousRules = domainRoutePolicy.list();
    return {
      commit: () => domainRoutePolicy.remove(payload),
      rollback: () => domainRoutePolicy.replace(previousRules),
    };
  }),
  proxyConfig: (port) => browserPolicyProxyConfig(port),
};

async function ensureCampusReady() {
  if (state.connected) return true;
  const result = await connect();
  if (!result?.ok && !state.connecting) return false;
  return waitForConnected();
}

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
        isTrusted: (origin, fingerprint) => certificateTrustStore.isTrusted(origin, fingerprint),
        trust: (origin, fingerprint) => certificateTrustStore.trust(origin, fingerprint),
      },
      credentialVault,
      parentWindow: () => win,
      toolbarFile: path.join(__dirname, 'renderer', 'campus-browser.html'),
      toolbarPreload: path.join(__dirname, 'lib', 'campus-toolbar-contract.js'),
      campusPreload: path.join(__dirname, 'campus-preload.js'),
      routingPolicy: browserRoutingPolicy,
      ensureCampusReady,
      onManageRoutingRules: () => {
        showWindow();
        win?.webContents.send('open-routing-rules');
      },
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

  let resolution;
  try {
    resolution = domainRoutePolicy.resolve(request.url);
  } catch (error) {
    const message = error.userMessage || error.message;
    state.lastError = message;
    emit();
    return { ok: false, error: message };
  }
  request.route = resolution.route;
  // The campus browser always starts from a live tunnel even when its first
  // host is routed DIRECT. This does not proxy the partner site, but it makes
  // a subsequent SAML POST/redirect back to a campus host work immediately
  // without losing request state while an engine starts in the background.
  if (!state.connected) {
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
    const message = error.code === 'SETTINGS_READ_FAILED'
      ? error.message
      : t('error.browserStart', { message: error.message });
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
    await routingPolicyTransactions.run(() => {
      assertSettingsPersistenceAvailable();
      const settings = loadSettingsOrReport();
      return {
        commit: () => saveSettings({ ...settings, updateCheckedAt: Date.now() }),
        rollback: () => saveSettings(settings),
      };
    });
  }
  if (result && result.updateAvailable) {
    updateInfo = result;
    emit();
  }
  return result;
}

// Automatic checks run at most once every 24h (persisted across restarts and
// long-running sessions); the settings-page button always forces a fresh check.
async function runAutomaticUpdateCheck() {
  if (!shouldAutoCheck(loadSettingsOrReport().updateCheckedAt)) return null;
  return runUpdateCheck();
}

// ---------- IPC ----------
const CONTROL_RENDERER_FILE = path.join(__dirname, 'renderer', 'index.html');
function trustedHandle(channel, handler) {
  registerTrustedIpcHandlers({
    ipcMain,
    getWebContents: () => (
      win && !win.isDestroyed() ? win.webContents : null
    ),
    allowedFiles: [CONTROL_RENDERER_FILE],
    handlers: { [channel]: handler },
  });
}

function routingIdentityFromIpc(value) {
  const source = plainObject(value);
  if (typeof source.includeSubdomains !== 'boolean') {
    throw new TypeError('路由规则范围无效');
  }
  return {
    host: boundedString(source.host, { minLength: 1, maxLength: 253, trim: true }),
    includeSubdomains: source.includeSubdomains,
  };
}

function routingRuleFromIpc(value) {
  const source = plainObject(value);
  return {
    ...routingIdentityFromIpc(source),
    route: enumValue(source.route, ['campus', 'direct']),
    ...(source.previous == null ? {} : { previous: routingIdentityFromIpc(source.previous) }),
  };
}

function settingsPatchFromIpc(value) {
  const source = allowedKeys(value, [
    'username', 'password', 'port', 'autoReconnect', 'maxAttempts', 'startAtLogin',
    'autoConnect', 'strictProxyAuth', 'closeAction', 'language', 'routeDomains',
  ]);
  const result = { ...source };
  if (source.username != null) {
    result.username = boundedString(source.username, { maxLength: 256 });
  }
  if (source.password != null) {
    result.password = boundedString(source.password, { maxLength: 4096 });
  }
  if (Array.isArray(source.routeDomains)) {
    result.routeDomains = boundedArray(
      source.routeDomains,
      (item) => boundedString(item, { minLength: 1, maxLength: 253, trim: true }),
      { maxLength: 64 },
    );
  } else if (source.routeDomains != null) {
    result.routeDomains = boundedString(source.routeDomains, { maxLength: 4096 });
  }
  return result;
}

trustedHandle('get-state', () => {
  let settings;
  try {
    settings = loadSettingsOrReport();
  } catch (error) {
    return {
      ...state,
      connectedAt,
      settings: null,
      hasPassword: false,
      pacUrl: pacUrl(),
      loggedIn: false,
      locale,
      platform: process.platform,
      version: app.getVersion(),
      update: updateInfo,
      campusResources: safeCampusResources({ customResources: [] }),
      lastError: error.message,
    };
  }
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

trustedHandle('list-routing-rules', () => {
  try {
    return { ok: true, rules: domainRoutePolicy.list() };
  } catch (error) {
    return { ok: false, error: error.message, rules: safeRoutingRules() };
  }
});
trustedHandle('save-routing-rule', async (_e, payload) => {
  try {
    const rule = routingRuleFromIpc(payload);
    const result = await runDomainPolicyTransaction(() => {
      const previousRules = domainRoutePolicy.list();
      return {
        commit: () => domainRoutePolicy.upsert(rule),
        rollback: () => domainRoutePolicy.replace(previousRules),
      };
    });
    return { ok: true, ...result, warning: null };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      rollbackIncomplete: error.rollbackIncomplete === true,
      rules: safeRoutingRules(),
    };
  }
});
trustedHandle('delete-routing-rule', async (_e, payload) => {
  try {
    const identity = routingIdentityFromIpc(payload);
    const rules = await runDomainPolicyTransaction(() => {
      const previousRules = domainRoutePolicy.list();
      return {
        commit: () => domainRoutePolicy.remove(identity),
        rollback: () => domainRoutePolicy.replace(previousRules),
      };
    });
    return { ok: true, rules, warning: null };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      rollbackIncomplete: error.rollbackIncomplete === true,
      rules: safeRoutingRules(),
    };
  }
});
trustedHandle('list-certificate-pins', () => {
  try {
    return { ok: true, pins: certificateTrustStore.list() };
  } catch (error) {
    return { ok: false, error: error.message, pins: [] };
  }
});
trustedHandle('delete-certificate-pin', (_e, payload) => {
  try {
    const source = plainObject(payload);
    const pins = certificateTrustStore.delete({
      origin: boundedString(source.origin, { minLength: 1, maxLength: 2048, trim: true }),
      fingerprint: boundedString(source.fingerprint, {
        minLength: 64,
        maxLength: 64,
        trim: true,
      }),
    });
    return { ok: true, pins };
  } catch (error) {
    // A transient read error must not turn a failed revocation into another
    // exception that escapes IPC. An empty fallback is deliberately
    // fail-closed; the UI can retry once the backing file is readable again.
    return { ok: false, error: error.message, pins: safeCertificatePins() };
  }
});

trustedHandle('save-resource', async (_e, payload) => {
  try {
    plainObject(payload);
    let result;
    await runDomainPolicyTransaction(() => {
      const previous = loadSettingsOrReport();
      result = upsertCustomResource(previous.customResources, payload);
      return {
        commit: () => saveSettings({ ...previous, customResources: result.resources }),
        rollback: () => saveSettings(previous),
      };
    });
    return {
      ok: true,
      resource: result.resource,
      resources: safeCampusResources(),
      warning: null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      rollbackIncomplete: error.rollbackIncomplete === true,
      resources: safeCampusResources(),
    };
  }
});
trustedHandle('delete-resource', async (_e, id) => {
  try {
    const safeId = boundedString(id, { minLength: 1, maxLength: 40, trim: true });
    await runDomainPolicyTransaction(() => {
      const previous = loadSettingsOrReport();
      const resources = deleteCustomResource(previous.customResources, safeId);
      return {
        commit: () => saveSettings({ ...previous, customResources: resources }),
        rollback: () => saveSettings(previous),
      };
    });
    return { ok: true, resources: safeCampusResources(), warning: null };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      rollbackIncomplete: error.rollbackIncomplete === true,
      resources: safeCampusResources(),
    };
  }
});
trustedHandle('reorder-resources', async (_e, ids) => {
  try {
    const safeIds = boundedArray(
      ids,
      (id) => boundedString(id, { minLength: 1, maxLength: 40, trim: true }),
      { maxLength: 32 },
    );
    await runDomainPolicyTransaction(() => {
      const previous = loadSettingsOrReport();
      const resources = reorderCustomResources(previous.customResources, safeIds);
      return {
        commit: () => saveSettings({ ...previous, customResources: resources }),
        rollback: () => saveSettings(previous),
      };
    });
    return { ok: true, resources: safeCampusResources(), warning: null };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      rollbackIncomplete: error.rollbackIncomplete === true,
      resources: safeCampusResources(),
    };
  }
});
trustedHandle('save', async (_e, rawPatch) => {
  let previous = null;
  let p;
  let next;
  let portChanged;
  let proxyAuthChanged;
  try {
    previous = loadSettingsOrReport();
    p = settingsPatchFromIpc(rawPatch);
    ({ settings: next, portChanged, proxyAuthChanged } = applySettingsPatch(previous, p));
  } catch (error) {
    return {
      ok: false,
      error: error.userMessage || error.message,
      settings: previous,
    };
  }
  const replacingPassword = typeof p.password === 'string' && p.password.length > 0;
  // Select the serialized policy transaction from the payload shape, not an
  // early settings snapshot. Another already-queued mutation can legitimately
  // change the current port/auth contract before this operation is rebased.
  const policyTransactionRequired = p.routeDomains != null || p.port != null ||
    p.strictProxyAuth != null;
  if (replacingPassword && policyTransactionRequired) {
    // Credential commits are deliberately short, synchronous journaled
    // transactions. A routing change has asynchronous PAC/browser apply and
    // rollback phases, so combining both domains would reopen a crash window.
    // The real UI already saves login credentials and network settings in
    // separate actions; reject an unexpected combined IPC payload explicitly.
    p.password = '';
    return {
      ok: false,
      error: t('error.credentialPolicyCombined'),
      settings: previous,
    };
  }

  const commitCandidateSettings = () => {
    const usernameChanged = p.username != null && next.username !== previous.username;
    if (usernameChanged && !replacingPassword) {
      throw Object.assign(new Error(t('error.usernameNeedsPassword')), {
        userMessage: t('error.usernameNeedsPassword'),
      });
    }
    if (!replacingPassword) {
      next = saveSettings(next);
      return next;
    }

    const transaction = runCredentialSettingsMutation({
      journalPath: CREDENTIAL_TRANSACTION,
      paths: credentialTransactionPaths,
      mutate: () => {
        if (!savePassword(p.password)) {
          throw Object.assign(new Error('protected credential storage unavailable'), {
            credentialStoreUnavailable: true,
          });
        }
        next = saveSettings(next);
        return next;
      },
    });
    if (!transaction.ok) {
      const passwordWasCleared = transaction.recovery?.status === 'credential-cleared';
      applyCredentialRecoveryOutcome(transaction.recovery, {
        clearedNoticeKey: 'error.settingsSaveFailedPasswordCleared',
      });
      const message = credentialTransactionBlocked
        ? t('error.credentialRecoveryBlocked')
        : (passwordWasCleared
          ? t('error.settingsSaveFailedPasswordCleared')
          : transaction.error?.credentialStoreUnavailable
          ? t('error.passwordStoreUnavailable')
          : t('error.settingsSaveFailed'));
      throw Object.assign(new Error(message), {
        userMessage: message,
        rollbackIncomplete: credentialTransactionBlocked,
      });
    }
    applyCredentialRecoveryOutcome(
      { ok: true, status: 'committed' },
      { clearNotice: true },
    );
    return transaction.value;
  };

  try {
    if (policyTransactionRequired) {
      await runDomainPolicyTransaction(() => {
        // Rebase on the latest committed settings inside the policy queue so a
        // resource mutation queued just before this save cannot be overwritten
        // by an older renderer snapshot.
        previous = loadSettingsOrReport();
        ({ settings: next, portChanged, proxyAuthChanged } = applySettingsPatch(previous, p));
        return {
          commit: commitCandidateSettings,
          rollback: () => saveSettings(previous),
          // The old engine still owns the previous endpoint/authentication
          // contract. Keep the browser behind its gate until reconnect's new
          // listener_ready event installs the candidate policy.
          resumeBrowser: !(portChanged || proxyAuthChanged),
        };
      });
    } else {
      // Every settings writer shares the same queue because customResources
      // and routeDomains live in this document. A visually unrelated save
      // must not race a suspended policy transaction and overwrite its newer
      // source-of-truth snapshot.
      await routingPolicyTransactions.run(() => {
        assertSettingsPersistenceAvailable();
        previous = loadSettingsOrReport();
        ({ settings: next, portChanged, proxyAuthChanged } = applySettingsPatch(previous, p));
        return {
          commit: commitCandidateSettings,
          // Password commits already own their rollback through the durable
          // credential journal. A second outer rollback would race recovery.
          rollback: replacingPassword ? undefined : () => saveSettings(previous),
        };
      });
    }
  } catch (saveError) {
    p.password = '';
    return {
      ok: false,
      error: saveError.userMessage || (policyTransactionRequired
        ? saveError.message
        : t('error.settingsSaveFailed')),
      rollbackIncomplete: saveError.rollbackIncomplete === true,
      settings: previous,
    };
  }
  p.password = '';
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
  if (p && typeof p.startAtLogin === 'boolean') { try { app.setLoginItemSettings({ openAtLogin: p.startAtLogin }); } catch {} }
  let reconnected = false;
  if (engineSupervisor.hasActive && (portChanged || proxyAuthChanged)) {
    const reconnectResult = await reconnect();
    reconnected = reconnectResult?.ok === true;
  }
  const warnings = [];
  if (warnings.length) {
    state.lastError = warnings.join('\n');
    emit();
  }
  return {
    ok: true,
    warning: warnings.join('\n') || null,
    settings: next,
    portChanged,
    proxyAuthChanged,
    reconnected,
  };
});
trustedHandle('connect', () => connect());
trustedHandle('disconnect', () => disconnect());
trustedHandle('reconnect', () => reconnect());
trustedHandle('ssh-config', () => {
  try {
    const port = socksPort();
    ensureExternalProxyAccess(port);
    return buildSshProxyCommand({
      helperPath: proxyHelperPath(),
      credentialFile: PROXY_HELPER_CREDENTIAL,
    });
  } catch {
    throw new Error(t('error.proxyCredentialUnavailable'));
  }
});
trustedHandle('copy-clash-node', async () => {
  try {
    const settings = loadSettingsOrReport();
    // Always include the stable RFC1929 credential. In compatibility mode the
    // engine's optional-auth contract accepts both legacy NO_AUTH clients and
    // Mihomo, which offers only RFC1929 whenever a node has credentials. The
    // same saved node therefore survives a later strict-mode change.
    const credential = ensureExternalProxyAccess(Number(settings.port));
    const generation = engineSupervisor.currentGeneration;
    if (engineSupervisor.hasActive &&
        !activeProxyCredential?.socksAuthentication(generation)) {
      const switched = await reconnect();
      if (!switched?.ok) {
        return { ok: false, error: t('error.proxyCredentialUnavailable') };
      }
    }
    clipboard.writeText(buildClashProxyYaml({
      port: settings.port,
      credential,
    }));
    // The renderer gets only completion status. In strict mode the generated
    // username/password exist solely in the main process and OS clipboard.
    return { ok: true };
  } catch {
    return { ok: false, error: t('error.proxyCredentialUnavailable') };
  }
});
trustedHandle('logout', () => routingPolicyTransactions.run(() => ({
  commit: async () => {
    const stopped = await disconnect();
    if (!stopped.ok) return { ok: false, error: t('error.engineStuck') };
    if (credentialTransactionBlocked) {
      const recovery = retryCredentialTransactionRecovery();
      if (recovery.status === 'blocked') {
        return { ok: false, error: t('error.credentialRecoveryBlocked') };
      }
    }

    let previous;
    try {
      previous = loadSettingsOrReport();
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const transaction = runCredentialSettingsMutation({
      journalPath: CREDENTIAL_TRANSACTION,
      paths: credentialTransactionPaths,
      mutate: () => {
        if (!restorePasswordSnapshot(CRED, { existed: false, data: null })) {
          throw new Error('could not durably remove encrypted credential');
        }
        return saveSettings({ ...previous, username: '' });
      },
    });
    if (!transaction.ok) {
      const passwordWasCleared = transaction.recovery?.status === 'credential-cleared';
      applyCredentialRecoveryOutcome(transaction.recovery, {
        clearedNoticeKey: 'error.logoutFailedPasswordCleared',
      });
      const message = credentialTransactionBlocked
        ? t('error.credentialRecoveryBlocked')
        : (passwordWasCleared
          ? t('error.logoutFailedPasswordCleared')
          : t('error.logoutFailed'));
      return {
        ok: false,
        error: message,
        rollbackIncomplete: credentialTransactionBlocked,
      };
    }
    applyCredentialRecoveryOutcome(
      { ok: true, status: 'committed' },
      { clearNotice: true },
    );
    return { ok: true, settings: transaction.value };
  },
})));
trustedHandle('get-logs', async () => {
  await logWriter.flush().catch(() => {});
  return readLogTail(LOG);
});
trustedHandle('open-log', async () => {
  await logWriter.flush().catch(() => {});
  await shell.openPath(LOG).catch(() => {});
});
trustedHandle('copy', (_e, text) => {
  clipboard.writeText(boundedString(text ?? '', { maxLength: 16 * 1024 }));
  return { ok: true };
});
trustedHandle('open-campus-browser', (_event, request) => {
  const source = request && typeof request === 'object' ? plainObject(request) : request;
  if (typeof source === 'string') {
    boundedString(source, { maxLength: 4096 });
  } else {
    boundedString(source.url ?? '', { maxLength: 4096 });
    if (source.route != null) enumValue(source.route, ['campus', 'direct']);
  }
  return connectAndOpenCampusBrowser(source);
});
// Only an explicit button press forces a network check; entering the settings
// page goes through the same 24h throttle as the timer.
trustedHandle('check-update', (_event, force) => {
  if (typeof force !== 'boolean') throw new TypeError('更新检查参数无效');
  return force ? runUpdateCheck() : runAutomaticUpdateCheck();
});
trustedHandle('open-external', (_event, url) => {
  // The renderer may only send users to this project's GitHub releases pages.
  if (!isAllowedReleaseUrl(url)) return { ok: false };
  shell.openExternal(url).catch(() => {});
  return { ok: true };
});
trustedHandle('resize', (_e, h) => {
  if (!Number.isFinite(h)) throw new TypeError('窗口尺寸无效');
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
      click: () => {
        const operation = state.connected ? disconnect() : connect();
        operation.catch(() => {});
      },
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
  return routingPolicyTransactions.run(() => {
    assertSettingsPersistenceAvailable();
    const previous = loadSettingsOrReport();
    const next = { ...previous, closeAction: action };
    return {
      commit: () => saveSettings(next),
      rollback: () => saveSettings(previous),
    };
  });
}

function requestQuit() {
  if (quitAllowed) {
    app.quit();
    return;
  }
  if (quitInFlight) return;
  isQuitting = true;
  connectivityRecovery.dispose();
  networkStatusMonitor.dispose();
  const operation = (async () => {
    try {
      await disconnect();
    } finally {
      await logWriter.close().catch(() => {});
      removeExternalProxySidecar();
      stableProxyCredential?.destroy();
      stableProxyCredential = null;
      if (tray && !tray.isDestroyed()) tray.destroy();
      tray = null;
      quitAllowed = true;
      app.quit();
    }
  })();
  quitInFlight = operation;
  operation.finally(() => {
    if (quitInFlight === operation) quitInFlight = null;
  });
}

async function handleWindowClose(event) {
  if (isQuitting) return;
  event.preventDefault();

  let action = 'ask';
  try { action = loadSettingsOrReport().closeAction; } catch {}
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
      if (result.checkboxChecked) await rememberCloseAction('minimize');
      hideToTray();
    } else if (result.response === 1) {
      if (result.checkboxChecked) await rememberCloseAction('quit');
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
      sandbox: true,
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
  win.loadFile(CONTROL_RENDERER_FILE);
  win.on('close', (event) => {
    handleWindowClose(event).catch((error) => {
      state.lastError = error.userMessage || error.message;
      emit();
    });
  });
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
app.on('certificate-error', (
  event, webContents, url, error, certificate, callback, isMainFrame,
) => {
  // This exception path belongs only to untrusted pages rendered by the campus
  // browser. The control window, the toolbar, and every unrelated Electron
  // request retain Chromium's normal certificate handling.
  routeCertificateError({
    owned: campusBrowser?.ownsWebContents(webContents) === true,
    isMainFrame,
    event,
    callback,
    prompt: () => campusBrowser.handleCertificateError({ url, error, certificate, callback }),
  });
});
app.on('login', (event, webContents, _details, authInfo, callback) => {
  // Chromium cannot authenticate SOCKS5 itself, so strict mode exposes an
  // authenticated HTTP CONNECT frontend on the same loopback port. Only a
  // page owned by the isolated campus browser, the exact current engine
  // generation, and the exact Basic challenge from 127.0.0.1 may receive the
  // in-memory credential. Control UI and arbitrary WebContents are excluded.
  const generation = engineSupervisor.currentGeneration;
  if (!campusBrowser?.ownsWebContents(webContents) ||
      !activeProxyCredential?.matchesProxyChallenge(authInfo, generation)) return;
  event.preventDefault();
  activeProxyCredential.answerProxyChallenge(authInfo, generation, callback);
});
app.whenReady().then(() => {
  try {
    locale = currentLocale();
  } catch {
    locale = effectiveLocale('auto', app.getLocale());
  }
  t = createT(locale);
  try {
    loadSettings();
  } catch (error) {
    state.lastError = reportSettingsReadFailure(error, { emitState: false }).message;
  }
  if (settingsRecoveryNotice) {
    settingsRecoveryNoticeText = t(settingsRecoveryNotice.kind === 'restored'
      ? 'error.settingsRestored'
      : 'error.settingsDefaults');
  }
  applyCredentialRecoveryOutcome(credentialTransactionRecovery, { emitState: false });
  syncRecoveryNotice(false);
  installApplicationMenu();
  // A PAC write can fail on a read-only or full user-data directory. That must
  // not leave the user with no window and no tray, so it is reported through the
  // normal error surface instead of aborting startup.
  try {
    refreshPacFile();
  } catch (error) {
    const pacError = error.userMessage || t('error.pacWriteAtBoot', { message: error.message });
    // Preserve an earlier credential-recovery or settings-read failure.  PAC
    // generation is a separate startup boundary and must not hide the reason
    // persistence/connection remains fail-closed.
    state.lastError = [state.lastError, pacError].filter(Boolean).join('\n');
  }
  createTray();
  createWindow();
  powerMonitor.on('suspend', () => connectivityRecovery.suspend());
  powerMonitor.on('resume', () => connectivityRecovery.resume());
  networkStatusMonitor.start().catch(() => {});
  let settings = null;
  try { settings = loadSettingsOrReport(); } catch {}
  if (settings && settings.autoConnect !== false && settings.username && hasStoredCredential()) {
    setTimeout(() => { connect().catch(() => {}); }, 500);
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
app.on('before-quit', (event) => {
  if (quitAllowed) return;
  event.preventDefault();
  requestQuit();
});
