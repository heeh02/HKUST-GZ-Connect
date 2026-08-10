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
  assert.doesNotMatch(html, /\.\.\/lib\/login-flow\.js/);
  assert.doesNotMatch(html, /\.\.\/lib\/resource-view\.js/);
  assert.match(appJs, /updateLoginProgress\(s\)/);
  assert.match(appJs, /function evaluateLoginProgress\(pending, state = \{\}\)/);
  assert.match(appJs, /function visibleResources\(resources, expanded/);
  assert.doesNotMatch(appJs, /window\.resourceView/);
  assert.doesNotMatch(appJs, /window\.loginFlow/);
  assert.doesNotMatch(appJs, /saved\.ok[\s\S]{0,180}lgPass'\)\.value\s*=\s*''[\s\S]{0,80}show\('dash'\)/);
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

test('update download uses one stable delegated listener', () => {
  assert.match(appJs, /\$\('updateHint'\)\.addEventListener\('click'/);
  assert.match(appJs, /event\.target\?\.closest\?\.\('#updateDownload'\)/);
  assert.doesNotMatch(appJs, /\$\('updateDownload'\)\.addEventListener/);
});
