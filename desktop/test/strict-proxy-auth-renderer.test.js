'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(renderer, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');
const proxyFeature = fs.readFileSync(path.join(renderer, 'proxy-auth-migration.js'), 'utf8');
const integrationFeature = fs.readFileSync(path.join(renderer, 'integration-center.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const integrationSuite = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'ipc', 'integration-center-suite.js'), 'utf8',
);
const i18n = require('../renderer/i18n');

test('strict proxy authentication is settings-driven rather than hardcoded in markup', () => {
  assert.match(html, /<label class="sw" for="strictProxyAuth">/);
  assert.match(html, /<input type="checkbox" id="strictProxyAuth" aria-describedby="strictProxyAuthSummary"\s*\/>/);
  assert.doesNotMatch(html, /id="strictProxyAuth"[^>]*checked/,
    'the persisted security setting, not stale markup, owns the checkbox state');
  assert.match(html, /id="strictProxyAuthSummary"[^>]*data-i18n="tower\.strictProxyAuthSummary"/);
  assert.match(html, /<details class="proxy-auth-details">/);
  assert.match(html, /data-i18n="tower\.strictProxyAuthMore"/);
  assert.match(html, /data-i18n="tower\.strictProxyAuthLess"/);
  assert.match(html, /id="strictProxyAuthHint"[^>]*data-i18n="tower\.strictProxyAuthHint"/);
  assert.match(html, /id="proxyAuthMigration"[^>]*hidden/);
  assert.match(html, /id="proxyAuthMigrationEnable"/);
  assert.match(html, /id="proxyAuthMigrationKeep"/);
});

test('strict authentication changes only through an explicit Control Tower apply', () => {
  assert.match(app, /\$\('strictProxyAuth'\)\.checked\s*=\s*settings\.strictProxyAuth\s*===\s*true/,
    'the normalized settings object owns the safe default');
  assert.match(proxyFeature, /async function applyStrict\(requested\)/);
  assert.match(proxyFeature, /api\.save\(\{ strictProxyAuth: requested \}\)/,
    'the explicit migration decision retains its narrow transaction');
  assert.doesNotMatch(proxyFeature, /\$\('strictProxyAuth'\)\.addEventListener\('change'/);
  assert.match(proxyFeature, /settings\.proxyAuthMigrationPending\s*!==\s*true/);
  assert.match(proxyFeature, /api\.save\(\{ proxyAuthMigrationAcknowledged: true \}\)/);
  assert.match(app, /window\.proxyAuthMigration\.createProxyAuthMigration\(\{/,
    'the application entry only composes the isolated feature');
  assert.match(app, /'towerPort', 'strictProxyAuth', 'autoReconnect'/,
    'ordinary checkbox changes must wait in the explicit dirty-form path');
  assert.match(html, /id="towerActions"[^>]*hidden/u);
  assert.doesNotMatch(html, /id="towerReconnect"/u);
  assert.match(app, /function setTowerDirty\(value\)[\s\S]{0,180}towerActions/u,
    'the apply action appears only while the form is dirty');

  const saveTowerStart = app.indexOf('async function saveTower()');
  const flashStart = app.indexOf('let flashTimer', saveTowerStart);
  assert.ok(saveTowerStart >= 0 && flashStart > saveTowerStart);
  assert.match(app.slice(saveTowerStart, flashStart), /strictProxyAuth:\s*\$\('strictProxyAuth'\)\.checked/,
    'applying the Control Tower form owns the requested authentication value');
  assert.match(proxyFeature, /checkbox\.checked\s*=\s*previous/,
    'a failed immediate save must restore the persisted switch value');
});

test('bilingual help states the secure default, explicit compatibility downgrade, and setup', () => {
  const zhSummary = i18n.dictionaries.zh['tower.strictProxyAuthSummary'];
  const enSummary = i18n.dictionaries.en['tower.strictProxyAuthSummary'];
  const zh = i18n.dictionaries.zh['tower.strictProxyAuthHint'];
  const en = i18n.dictionaries.en['tower.strictProxyAuthHint'];
  assert.match(zhSummary, /新安装默认开启/);
  assert.match(zhSummary, /本机其他进程或用户/);
  assert.match(enSummary, /enabled by default on new installations/i);
  assert.match(enSummary, /local process or user/i);
  assert.match(zh, /本地回环端口.*授权边界/);
  assert.match(zh, /旧 SOCKS5 客户端.*显式关闭/);
  assert.match(zh, /应用内浏览器(?:会)?自动处理/);
  assert.match(zh, /Clash.*Mihomo.*VS Code/);
  assert.match(zh, /点击应用/);
  assert.match(zh, /外部工具集成/);
  assert.match(zh, /127\.0\.0\.1/);
  assert.match(en, /Campus Browser handles it automatically/i);
  assert.match(en, /local authorization boundary/i);
  assert.match(en, /legacy SOCKS5 client/i);
  assert.match(en, /Click Apply/i);
  assert.match(en, /External Tool Integrations/i);
  assert.match(en, /127\.0\.0\.1/);
});

test('Clash credentials never cross into renderer JavaScript', () => {
  assert.match(html, /id="integrationList"/u);
  assert.doesNotMatch(html, /data-copy="clash"/u);
  assert.match(integrationFeature, /api\.prepareIntegration\(\{ adapterId, action \}\)/u);
  assert.match(integrationFeature, /api\.confirmIntegration\(\{ confirmationHandle: handle \}\)/u);
  assert.doesNotMatch(integrationFeature, /username|password|buildClashProxyYaml/u);
  assert.doesNotMatch(app, /buildClashProxyYaml|username:\s*.*Clash|password:\s*.*Clash/);
  assert.match(main, /registerCoreControlIpc\(\{/);
  assert.doesNotMatch(integrationSuite, /copyClashNode|buildClashProxyYaml|sshConfig/u);
  assert.match(integrationSuite, /createIntegrationCenterRuntime/u);
});

test('Clash and Mihomo share one explained configuration surface', () => {
  assert.match(html, /<details class="integration-explainer">/u);
  assert.match(html, /data-i18n="integration\.explainSummary"/u);
  assert.match(html, /data-i18n="integration\.explainStep1"/u);
  assert.match(html, /data-i18n="integration\.explainPrivacy"/u);
  assert.doesNotMatch(integrationFeature, /['"]mihomo_yaml['"]/u,
    'the retired duplicate adapter must not remain a second Renderer card');
  assert.match(i18n.dictionaries.zh['integration.adapter.clash_mihomo_yaml'], /Clash \/ Mihomo/u);
  assert.match(i18n.dictionaries.zh['integration.explainStep2'], /SOCKS5.*校园域名分流/u);
  assert.match(i18n.dictionaries.zh['integration.explainPrivacy'], /不含校园账号密码/u);
  assert.match(i18n.dictionaries.en['integration.explainStep3'], /other sites keep their existing routes/i);
});

test('strict proxy authentication card wraps safely in narrow windows', () => {
  assert.match(css, /\.proxy-auth-setting\s*\{[^}]*border-radius:[^}]*background:/);
  assert.match(css, /\.sw\s*>\s*span\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.sw input\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(css, /\.proxy-auth-details summary\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.proxy-auth-details\[open\] \.proxy-auth-chevron\s*\{[^}]*rotate\(180deg\)/);
  assert.match(css, /@media\s*\(max-width:\s*619px\)[\s\S]*\.proxy-auth-setting \.sw\s*\{[^}]*align-items:\s*flex-start/);
});
