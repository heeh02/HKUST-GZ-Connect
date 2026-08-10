'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(renderer, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
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
});

test('strict authentication switch saves immediately without committing other dirty fields', () => {
  assert.match(app, /\$\('strictProxyAuth'\)\.checked\s*=\s*settings\.strictProxyAuth\s*===\s*true/,
    'the normalized settings object owns the safe default');
  assert.match(app, /async function applyStrictProxyAuth\(requested\)/);
  assert.match(app, /window\.api\.save\(\{ strictProxyAuth: requested \}\)/,
    'the switch owns a narrow, immediate settings transaction');
  assert.match(app, /\$\('strictProxyAuth'\)\.addEventListener\('change'/);
  assert.doesNotMatch(app, /'towerPort', 'routeDomains', 'strictProxyAuth', 'autoReconnect'/,
    'the switch must not enter the general dirty-form path');

  const saveTowerStart = app.indexOf('async function saveTower()');
  const strictSaveStart = app.indexOf('async function applyStrictProxyAuth(', saveTowerStart);
  assert.ok(saveTowerStart >= 0 && strictSaveStart > saveTowerStart);
  assert.doesNotMatch(app.slice(saveTowerStart, strictSaveStart), /strictProxyAuth\s*:/,
    'saving unrelated tower fields must not implicitly toggle authentication');
  assert.match(app.slice(strictSaveStart), /checkbox\.checked\s*=\s*previous/,
    'a failed immediate save must restore the persisted switch value');
});

test('bilingual help states one-time external-tool setup, stable credentials, and loopback binding', () => {
  const zhSummary = i18n.dictionaries.zh['tower.strictProxyAuthSummary'];
  const enSummary = i18n.dictionaries.en['tower.strictProxyAuthSummary'];
  const zh = i18n.dictionaries.zh['tower.strictProxyAuthHint'];
  const en = i18n.dictionaries.en['tower.strictProxyAuthHint'];
  assert.match(zhSummary, /默认关闭/);
  assert.match(zhSummary, /不影响/);
  assert.match(enSummary, /off by default/i);
  assert.match(enSummary, /work normally/i);
  assert.match(zh, /例如.*实验室.*共用/);
  assert.match(zh, /个人电脑.*关闭/);
  assert.match(zh, /应用内浏览器(?:会)?自动认证/);
  assert.match(zh, /Clash.*SSH/);
  assert.match(zh, /立即保存/);
  assert.match(zh, /开启前.*复制 Clash 节点/);
  assert.match(zh, /重连或重启不会更换凭据/);
  assert.match(zh, /127\.0\.0\.1/);
  assert.match(en, /built-in browser authenticates automatically/i);
  assert.match(en, /Example:.*shared lab computer/i);
  assert.match(en, /personal computer.*leave it off/i);
  assert.match(en, /switch saves immediately/i);
  assert.match(en, /Before enabling it.*Copy Clash Node/i);
  assert.match(en, /does not rotate the credential/i);
  assert.match(en, /127\.0\.0\.1/);
});

test('Clash credentials never cross into renderer JavaScript', () => {
  assert.match(html, /data-copy="clash"[^>]*data-i18n="tower\.copyClash"/);
  assert.match(app, /window\.api\.copyClashNode\(\)/);
  assert.doesNotMatch(app, /buildClashProxyYaml|username:\s*.*Clash|password:\s*.*Clash/);
  assert.match(main, /trustedHandle\('copy-clash-node'/);
  assert.match(main, /clipboard\.writeText\(buildClashProxyYaml/);
  assert.match(main, /return \{ ok: true \}/);
});

test('strict proxy authentication card wraps safely in narrow windows', () => {
  assert.match(css, /\.proxy-auth-setting\s*\{[^}]*border-radius:[^}]*background:/);
  assert.match(css, /\.sw\s*>\s*span\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.sw input\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(css, /\.proxy-auth-details summary\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.proxy-auth-details\[open\] \.proxy-auth-chevron\s*\{[^}]*rotate\(180deg\)/);
  assert.match(css, /@media\s*\(max-width:\s*619px\)[\s\S]*\.proxy-auth-setting \.sw\s*\{[^}]*align-items:\s*flex-start/);
});
