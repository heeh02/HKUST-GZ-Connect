'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const { createLegacyFlatSourcePaths } = require('../lib/profile-workspace-layout');
const { normalizeSettings } = require('../lib/settings-store');

const WAIT_MS = 30_000;

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForMarker(file, child, output) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    if (child.exitCode !== null && !fs.existsSync(file)) {
      // The first process exits after relaunch. Keep waiting for its successor.
    }
    await delay(100);
  }
  throw new Error(`persistence migration marker timed out: ${output.value.slice(-1000)}`);
}

async function stopOwnedProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return; }
    await delay(50);
  }
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

async function run() {
  app.setName('HKUST(GZ) Connect');
  await app.whenReady();
  assert.equal(safeStorage.isEncryptionAvailable(), true);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hkust-persistence-e2e-'));
  const legacy = createLegacyFlatSourcePaths(userData);
  const settings = normalizeSettings({
    username: 'synthetic-user',
    port: 6180,
    autoConnect: false,
    startAtLogin: false,
    routeDomains: ['hkust-gz.edu.cn'],
  });
  const bytes = Buffer.from(JSON.stringify(settings), 'utf8');
  fs.writeFileSync(legacy.settings, bytes, { mode: 0o600 });
  fs.writeFileSync(legacy.settingsBackup, bytes, { mode: 0o600 });
  fs.writeFileSync(legacy.vpnCredential, safeStorage.encryptString('synthetic-password'), {
    mode: 0o600,
  });
  fs.writeFileSync(legacy.routingRules, '{"schemaVersion":1,"rules":[]}', { mode: 0o600 });
  const markerPath = path.join(userData, 'persistence-e2e-ready.json');
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  Object.assign(environment, {
    HKUSTGZ_USER_DATA_DIR: userData,
    HKUSTGZ_PERSISTENCE_E2E: '1',
    ELECTRON_ENABLE_LOGGING: '1',
  });
  const output = { value: '' };
  const child = spawn(process.execPath, [path.join(__dirname, '..')], {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => { output.value = (output.value + data).slice(-4000); });
  child.stderr.on('data', (data) => { output.value = (output.value + data).slice(-4000); });
  child.on('exit', (code, signal) => {
    output.value = `${output.value}\ninitial-exit code=${code} signal=${signal}`.slice(-4000);
  });
  let marker = null;
  try {
    marker = await waitForMarker(markerPath, child, output);
    assert.equal(marker.mode, 'profile-workspace');
    assert.equal(Number.isInteger(marker.pid) && marker.pid > 0, true);
    assert.equal(fs.existsSync(legacy.settings), false);
    assert.equal(fs.existsSync(legacy.vpnCredential), false);
    assert.equal(fs.existsSync(path.join(userData, 'global', 'settings.json')), true);
    const profilesRoot = path.join(userData, 'profiles');
    assert.equal(fs.readdirSync(profilesRoot).length, 1);
  } finally {
    if (marker?.pid) await stopOwnedProcess(marker.pid);
    try { child.kill('SIGTERM'); } catch {}
    await delay(100);
    if (marker) fs.rmSync(userData, { recursive: true, force: true });
    else process.stderr.write(`persistence-e2e-user-data=${userData}\n`);
  }
}

run().then(() => app.quit()).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
  app.exit(1);
});
