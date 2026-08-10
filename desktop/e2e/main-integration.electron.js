'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-main-e2e-'));
process.env.HKUSTGZ_USER_DATA_DIR = profile;

const fingerprint = 'ab'.repeat(32);
fs.writeFileSync(path.join(profile, 'campus-certificate-trust.json'), JSON.stringify({
  version: 2,
  updatedAt: 1_800_000_000_000,
  pins: [{
    origin: 'https://certificate.example:4433',
    fingerprint,
    updatedAt: 1_800_000_000_000,
  }],
}), { mode: 0o600 });

require('../main');

async function waitForControlWindow() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find((candidate) => (
      candidate.webContents.getURL().endsWith('/renderer/index.html')
    ));
    if (window && !window.webContents.isLoading()) return window;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('control window did not become ready');
}

async function invoke(window, expression) {
  return window.webContents.executeJavaScript(`(async () => (${expression}))()`);
}

async function run() {
  await app.whenReady();
  const control = await waitForControlWindow();

  const initial = await invoke(control, 'window.api.getState()');
  assert.equal(initial.settings.port, 1080);
  assert.equal(initial.dnsMode, 'unknown');

  const usernameWithoutPassword = await invoke(control, `window.api.save({
    username: 'e2e-user',
  })`);
  assert.equal(usernameWithoutPassword.ok, false);
  assert.equal(usernameWithoutPassword.settings.username, '');

  const savedSettings = await invoke(control, `window.api.save({
    port: 6180,
    strictProxyAuth: false,
  })`);
  assert.equal(savedSettings.ok, true);
  assert.equal(savedSettings.settings.port, 6180);

  const savedRule = await invoke(control, `window.api.saveRoutingRule({
    host: 'login.microsoftonline.com',
    includeSubdomains: false,
    route: 'direct',
  })`);
  assert.equal(savedRule.ok, true);
  assert.equal(savedRule.rules.length, 1);
  assert.equal(savedRule.rules[0].route, 'direct');
  const listedRules = await invoke(control, 'window.api.listRoutingRules()');
  assert.deepEqual(listedRules.rules.map((rule) => ({
    host: rule.host,
    includeSubdomains: rule.includeSubdomains,
    route: rule.route,
  })), [{
    host: 'login.microsoftonline.com',
    includeSubdomains: false,
    route: 'direct',
  }]);

  const savedResource = await invoke(control, `window.api.saveResource({
    name: '测试 IP 服务',
    description: '自定义端口',
    url: 'https://103.189.154.10:4433',
    route: 'campus',
  })`);
  assert.equal(savedResource.ok, true);
  assert.equal(savedResource.resource.url, 'https://103.189.154.10:4433/');
  assert.equal(savedResource.resources.filter((resource) => (
    resource.url === 'https://103.189.154.10:4433/'
  )).length, 1);

  const listedPins = await invoke(control, 'window.api.listCertificatePins()');
  assert.equal(listedPins.ok, true);
  assert.equal(listedPins.pins.length, 1);
  assert.equal(listedPins.pins[0].fingerprint, fingerprint);
  const deletedPin = await invoke(control, `window.api.deleteCertificatePin({
    origin: 'https://certificate.example:4433',
    fingerprint: '${fingerprint}',
  })`);
  assert.deepEqual(deletedPin, { ok: true, pins: [] });

  const managerVisible = await control.webContents.executeJavaScript(`(async () => {
    document.getElementById('manageRoutingRules').click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return document.getElementById('routingRulesDialog').open;
  })()`);
  assert.equal(managerVisible, true);

  const strictSettings = await invoke(control, `window.api.save({ strictProxyAuth: true })`);
  assert.equal(strictSettings.ok, true);
  assert.equal(strictSettings.proxyAuthChanged, true);
  assert.equal(strictSettings.settings.strictProxyAuth, true);
  const directWithoutTunnel = await invoke(control, `window.api.openCampusBrowser({
    url: 'https://outlook.office.com/owa/',
    route: 'direct',
  })`);
  assert.equal(directWithoutTunnel.ok, false,
    'even a DIRECT first page must establish the tunnel before preserving a later SAML return');
  assert.equal(BrowserWindow.getAllWindows().some((candidate) => (
    candidate.webContents.getURL().includes('/renderer/campus-browser.html')
  )), false);

  const settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
  assert.equal(settings.username, '');
  assert.equal(settings.port, 6180);
  assert.equal(settings.strictProxyAuth, true);
  const rules = JSON.parse(fs.readFileSync(path.join(profile, 'routing-rules.json'), 'utf8'));
  assert.equal(rules.version, 1);
  assert.equal(rules.rules[0].host, 'login.microsoftonline.com');
  assert.ok(fs.readFileSync(path.join(profile, 'routing.pac'), 'utf8').includes('127.0.0.1:6180'));
  process.stdout.write('main integration: PASS\n');
}

run().then(
  () => app.quit(),
  (error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exitCode = 1;
    app.quit();
  },
);

app.on('quit', () => {
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});
