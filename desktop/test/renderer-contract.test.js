'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererDir = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(rendererDir, 'styles.css'), 'utf8');
const connectionCss = fs.readFileSync(path.join(rendererDir, 'styles', 'connection-strip.css'), 'utf8');
const appJs = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
const studentHomeJs = fs.readFileSync(path.join(rendererDir, 'student-home.js'), 'utf8');
const layoutControllerJs = fs.readFileSync(path.join(rendererDir, 'resource-layout-controller.js'), 'utf8');
const usabilityControllerJs = fs.readFileSync(path.join(rendererDir, 'usability-controller.js'), 'utf8');

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
  assert.match(html, /id="openCampusWorkspace"/u);
  assert.match(appJs, /openCampusWorkspace[\s\S]*openCampusBrowser/u);
  assert.match(appJs, /manageResources[\s\S]*openBookmarkManager/u);
  assert.match(html, /class="custom-url-details" hidden/u);
});

test('dashboard usability layer keeps status shortcuts feedback and recovery outside Main', () => {
  assert.match(html, /id="navConnectionState"/u);
  assert.match(html, /id="globalToast"[^>]*aria-live="polite"/u);
  assert.match(html, /<script src="usability-controller\.js"><\/script>/u);
  assert.match(usabilityControllerJs, /PAGE_SHORTCUTS/u);
  assert.match(usabilityControllerJs, /event\.key\.toLowerCase\(\) === 'k'/u);
  assert.match(usabilityControllerJs, /data-resource-empty-action/u);
  assert.match(layoutControllerJs, /ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/u);
  assert.match(layoutControllerJs, /scrollIntoView/u);
  assert.doesNotMatch(appJs, /addEventListener\('keydown'[\s\S]*PAGE_SHORTCUTS/u,
    'global shortcuts belong to the usability module');
});

test('WebResource shelf supports responsive ID-only search categories favorites and recent views', () => {
  for (const id of ['resourceSearch', 'resourceView', 'resourceViewChips', 'campusResources']) {
    assert.match(html, new RegExp(`id="${id}"`, 'u'));
  }
  for (const view of [
    'favorites', 'recent', 'newcomer', 'courses', 'research', 'labs',
    'student-finance', 'expenses', 'career', 'campus-life', 'documents', 'tools',
    'staff', 'custom',
  ]) {
    assert.match(html, new RegExp(`value="${view}"`, 'u'));
  }
  assert.match(appJs, /window\.api\.openResource\(selected\.id\)/u);
  assert.match(appJs, /window\.api\.toggleResourceFavorite\(resource\.id\)/u);
  assert.doesNotMatch(appJs, /openCampusBrowser\(\{\s*url:\s*selected\.url/u);
  assert.match(css, /\.resource-library-controls/u);
  assert.match(css, /\.resource-favorite\.active/u);
  assert.match(layoutControllerJs, /new window\.ResizeObserver/u);
  assert.match(layoutControllerJs, /window\.requestAnimationFrame/u);
  assert.match(appJs, /layout:\s*presentation\.layout/u);
  assert.doesNotMatch(studentHomeJs, /class="resource-desc"|class="resource-origin"/u);
  const policyScript = html.indexOf('<script src="resource-layout-policy.js"></script>');
  const controllerScript = html.indexOf('<script src="resource-layout-controller.js"></script>');
  const studentHomeScript = html.indexOf('<script src="student-home.js"></script>');
  assert.ok(policyScript > 0 && policyScript < controllerScript && controllerScript < studentHomeScript,
    'resource layout modules must load before Student Home');
});

test('control panel has responsive wide and compact layout rules', () => {
  assert.match(css, /@media\s*\(max-width:\s*459px\)/);
  assert.match(css, /@media\s*\(max-width:\s*359px\)[\s\S]*\.resource-grid[^}]*grid-template-columns:\s*1fr/u);
  assert.match(css, /\.resource-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/u);
  assert.match(css, /data-resource-layout="standard"/u);
  assert.match(css, /data-resource-layout="wide"/u);
  assert.match(connectionCss, /\.page\[data-page="connect"\][^{]*\{/);
  assert.match(appJs, /document\.querySelector\('\.content'\)[\s\S]{0,100}scrollTop\s*=\s*0/u);
});

test('Campus Browser chrome keeps the minimum task set and derives external open in Main', () => {
  const browserHtml = fs.readFileSync(path.join(rendererDir, 'campus-browser.html'), 'utf8');
  const browserJs = fs.readFileSync(path.join(rendererDir, 'campus-browser.js'), 'utf8');
  for (const id of [
    'tabs', 'back', 'forward', 'reload', 'address', 'routeBadge', 'openExternal',
    'bookmarkBar', 'bookmarkItems', 'bookmarkMore', 'manageBookmarks',
  ]) {
    assert.match(browserHtml, new RegExp(`id="${id}"`, 'u'));
  }
  assert.match(browserJs, /command\('open-external'\)/u);
  assert.match(browserJs, /command\('open-resource',\s*entry\.id\)/u);
  assert.match(browserJs, /command\('manage-bookmarks'\)/u);
  assert.doesNotMatch(browserJs, /openExternal\(address\.value/u,
    'toolbar renderer must not provide URL authority for external open');
});

test('Campus Workspace is a real local renderer with ID-only actions and modular portal surfaces', () => {
  const workspaceHtml = fs.readFileSync(path.join(rendererDir, 'campus-workspace.html'), 'utf8');
  const workspaceJs = fs.readFileSync(path.join(rendererDir, 'campus-workspace.js'), 'utf8');
  const workspaceModel = fs.readFileSync(path.join(rendererDir, 'campus-workspace-model.js'), 'utf8');
  const workspaceCss = fs.readFileSync(path.join(rendererDir, 'campus-workspace.css'), 'utf8');
  for (const id of [
    'homeScreen', 'servicePanel', 'backToServices', 'primaryTabs', 'primaryWorkspace',
    'primaryRecent', 'primaryCatalog', 'secondaryNavigation', 'secondarySelect', 'serviceViewTabs', 'quickCreateGroup',
    'serviceViewGrid', 'servicePager', 'manageScreen', 'resourcePool',
    'manageFolderNav', 'managePager', 'createGroup',
  ]) assert.match(workspaceHtml, new RegExp(`id="${id}"`, 'u'));
  assert.doesNotMatch(workspaceHtml, /workspace-header|workspace-command|id="workspaceSearch"|id="manageRules"/u);
  assert.match(workspaceModel, /SCREENS[\s\S]*home[\s\S]*manage/u);
  assert.doesNotMatch(workspaceModel, /SCREENS[^\n]*catalog/u);
  assert.match(workspaceModel, /TASK_CATEGORIES[\s\S]*id:\s*'courses'[\s\S]*categoryOf/u);
  assert.match(workspaceJs, /command\('open-resource',\s*\{\s*resourceId:/u);
  assert.match(workspaceJs, /command\('toggle-favorite',\s*\{\s*resourceId:/u);
  assert.match(workspaceJs, /command\('focus-address'\)/u);
  assert.doesNotMatch(workspaceJs, /window\.open|location\.href|resource\.url/u);
  assert.match(workspaceCss, /\.surface\s*\{[^}]*background:\s*var\(--workspace-surface\)/u);
  assert.match(workspaceCss, /@media\s*\(min-width:\s*1100px\)[\s\S]*repeat\(3/u);
  assert.match(workspaceCss, /\.resource-icon\s*\{[^}]*width:\s*36px[^}]*height:\s*36px/u);
  assert.match(workspaceCss, /@media\s*\(max-width:\s*759px\)[\s\S]*grid-template-columns:\s*1fr/u);
  assert.match(workspaceCss, /body\s*\{[^}]*overflow:\s*auto/u);
  assert.match(workspaceCss, /\.pager-range[\s\S]*\.pager-button/u);
});

test('notifications keep a compact state summary and raw diagnostics collapsed', () => {
  assert.match(html, /id="notificationCard"/u);
  assert.doesNotMatch(html, /class="help-section"/u);
  assert.match(html, /<details class="diagnostic-details">/u);
  assert.doesNotMatch(html, /<details class="diagnostic-details"[^>]*open/u);
});

test('connected status remains static instead of continuously repainting Electron', () => {
  assert.match(connectionCss, /\.conn-status\.on\s*\{[^}]*color:\s*var\(--ok\)/);
  assert.doesNotMatch(connectionCss, /\.conn-status\.on\s+\.dot\s*\{[^}]*animation:/);
  assert.doesNotMatch(`${css}\n${connectionCss}`, /@keyframes\s+ping/);
});

test('update download uses one stable delegated listener', () => {
  assert.match(appJs, /\$\('updateHint'\)\.addEventListener\('click'/);
  assert.match(appJs, /event\.target\?\.closest\?\.\('#updateDownload'\)/);
  assert.doesNotMatch(appJs, /\$\('updateDownload'\)\.addEventListener/);
});
