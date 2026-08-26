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
  assert.match(html, /<script src="\.\.\/lib\/browser\/auth\/login-flow\.js"><\/script>/);
  assert.match(
    html,
    /<script src="\.\.\/lib\/resources\/presentation\/resource-view\.js"><\/script>/,
  );
  assert.match(html, /<script src="student-home\.js"><\/script>/);
  assert.match(appJs, /updateLoginProgress\(s\)/);
  assert.match(appJs, /const \{ evaluateLoginProgress \} = window\.loginFlow/);
  assert.match(appJs, /window\.studentHome\.renderStudentHome/u);
  assert.doesNotMatch(appJs, /function evaluateLoginProgress\(/);
  assert.doesNotMatch(appJs, /function visibleResources\(|function routeLabel\(/);
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
  assert.match(appJs, /expectedProfileId: expectedProfileId|expectedProfileId \}/u);
  assert.doesNotMatch(appJs, /probeCustomGateway|confirmCustomGateway|getElementById\(['"]schoolProfileSelect/u,
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

test('WebResource shelf supports ID-only open, search, categories, favorites and recent views', () => {
  for (const id of ['resourceSearch', 'resourceView', 'campusResources']) {
    assert.match(html, new RegExp(`id="${id}"`, 'u'));
  }
  for (const view of ['favorites', 'recent', 'common', 'academic', 'campus-service', 'custom']) {
    assert.match(html, new RegExp(`value="${view}"`, 'u'));
  }
  assert.match(appJs, /window\.api\.openResource\(selected\.id\)/u);
  assert.match(appJs, /window\.api\.toggleResourceFavorite\(resource\.id\)/u);
  assert.doesNotMatch(appJs, /openCampusBrowser\(\{\s*url:\s*selected\.url/u);
  assert.match(css, /\.resource-library-controls/u);
  assert.match(css, /\.resource-favorite\.active/u);
});

test('control panel has responsive wide and compact layout rules', () => {
  assert.match(css, /@media\s*\(min-width:\s*800px\)/);
  assert.match(css, /@media\s*\(max-width:\s*559px\)/);
  assert.match(css, /@media\s*\(max-width:\s*359px\)[\s\S]*\.resource-grid[^}]*grid-template-columns:\s*1fr/u);
  assert.match(css, /\.resource-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/u);
  assert.match(css, /\.page\[data-page="connect"\][^{]*\{/);
  assert.match(appJs, /document\.querySelector\('\.content'\)[\s\S]{0,100}scrollTop\s*=\s*0/u);
});

test('Campus Browser chrome keeps the minimum task set and derives external open in Main', () => {
  const browserHtml = fs.readFileSync(path.join(rendererDir, 'campus-browser.html'), 'utf8');
  const browserJs = fs.readFileSync(path.join(rendererDir, 'campus-browser.js'), 'utf8');
  for (const id of ['tabs', 'back', 'forward', 'reload', 'address', 'routeBadge', 'openExternal']) {
    assert.match(browserHtml, new RegExp(`id="${id}"`, 'u'));
  }
  assert.match(browserJs, /command\('open-external'\)/u);
  assert.doesNotMatch(browserJs, /openExternal\(address\.value/u,
    'toolbar renderer must not provide URL authority for external open');
});

test('notifications keep concise help visible and raw diagnostics collapsed', () => {
  for (const key of [
    'notif.helpOpenTitle', 'notif.helpRouteTitle', 'notif.helpTroubleshootTitle',
  ]) assert.match(html, new RegExp(`data-i18n="${key}"`, 'u'));
  assert.match(html, /<details class="diagnostic-details">/u);
  assert.doesNotMatch(html, /<details class="diagnostic-details"[^>]*open/u);
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
