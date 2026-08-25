'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererDir = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(rendererDir, 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');

test('login fields keep native keyboard and password-manager semantics', () => {
  assert.match(html, /id="lgUser"[^>]*name="username"/);
  assert.match(html, /id="lgUser"[^>]*autocomplete="username"/);
  assert.match(html, /id="lgPass"[^>]*name="password"/);
  assert.match(html, /id="lgPass"[^>]*type="password"/);
  assert.match(html, /id="lgPass"[^>]*autocomplete="current-password"/);
  assert.doesNotMatch(html, /id="lgPass"[^>]*(?:disabled|readonly)/);
  assert.match(css, /\.inp\s*\{[^}]*-webkit-user-select:\s*text/);
  assert.match(html, /<script src="\.\.\/lib\/login-flow\.js"><\/script>/);
  assert.match(html, /<script src="\.\.\/lib\/resource-view\.js"><\/script>/);
  assert.match(appJs, /updateLoginProgress\(s\)/);
  assert.match(appJs, /const \{ evaluateLoginProgress \} = window\.loginFlow/);
  assert.match(appJs, /const \{ routeLabel, visibleResources \} = window\.resourceView/);
  assert.doesNotMatch(appJs, /function evaluateLoginProgress\(/);
  assert.doesNotMatch(appJs, /function visibleResources\(/);
  assert.doesNotMatch(appJs, /function routeLabel\(/);
  assert.doesNotMatch(appJs, /saved\.ok[\s\S]{0,180}lgPass'\)\.value\s*=\s*''[\s\S]{0,80}show\('dash'\)/);
});

test('login owns a modular bilingual School selector with an explicit unreviewed confirmation', () => {
  assert.match(html, /id="schoolProfileSelect"/u);
  assert.match(html, /id="customGatewayConfirmation"[^>]*hidden/u);
  assert.match(html, /id="confirmCustomGateway"/u);
  assert.match(html, /class="gateway-warning"/u);
  const selectorScript = html.indexOf('<script src="school-profile-selector.js"></script>');
  const appScript = html.indexOf('<script src="app.js"></script>');
  assert.ok(selectorScript > 0 && selectorScript < appScript);
  assert.match(css, /@media\s*\(max-width:\s*459px\)/u);
  assert.doesNotMatch(appJs, /probeCustomGateway|confirmCustomGateway|schoolProfileSelect/u,
    'School onboarding belongs to its renderer feature module');
});

test('Control Tower owns a modular Integration Center instead of scattered secret copy buttons', () => {
  assert.match(html, /id="integrationList"/u);
  assert.match(html, /id="integrationDialog"/u);
  assert.match(html, /id="confirmIntegration"/u);
  assert.doesNotMatch(html, /data-copy="(?:pac|clash|ssh)"/u);
  const integrationScript = html.indexOf('<script src="integration-center.js"></script>');
  const appScript = html.indexOf('<script src="app.js"></script>');
  assert.ok(integrationScript > 0 && integrationScript < appScript);
  assert.doesNotMatch(appJs, /prepareIntegration|confirmIntegration|listIntegrations/u);
});

test('dashboard exposes collapsible secondary sections', () => {
  assert.match(html, /data-collapsible="stats"/);
  assert.match(html, /data-collapsible="gateway"/);
  assert.match(html, /id="toggleResources"/);
});

test('control panel has responsive wide and compact layout rules', () => {
  assert.match(css, /@media\s*\(min-width:\s*620px\)/);
  assert.match(css, /@media\s*\(max-width:\s*619px\)/);
  assert.match(css, /\.page\[data-page="connect"\][^{]*\{/);
});

test('connected status remains static instead of continuously repainting Electron', () => {
  assert.match(css, /\.conn-status\.on\s*\{[^}]*color:\s*var\(--ok\)/);
  assert.doesNotMatch(css, /\.conn-status\.on\s+\.dot\s*\{[^}]*animation:/);
  assert.doesNotMatch(css, /@keyframes\s+ping/);
});

test('update download uses one stable delegated listener', () => {
  assert.match(appJs, /\$\('updateHint'\)\.addEventListener\('click'/);
  assert.match(appJs, /event\.target\?\.closest\?\.\('#updateDownload'\)/);
  assert.doesNotMatch(appJs, /\$\('updateDownload'\)\.addEventListener/);
});
