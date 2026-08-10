'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(renderer, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');

test('routing-rule manager is bounded, accessible, local-only CRUD UI', () => {
  assert.match(html, /<dialog id="routingRulesDialog"[^>]*aria-labelledby="routingRulesTitle"[^>]*aria-describedby="routingRulesDescription"/);
  assert.match(html, /id="routingRuleList"[^>]*role="list"[^>]*data-i18n-attr="aria-label:routing\.listLabel"/);
  assert.match(html, /id="routingRuleHost"[^>]*maxlength="253"[^>]*autocomplete="off"/);
  assert.match(html, /id="routingRuleScope"[\s\S]*value="exact"[\s\S]*value="subdomains"/);
  assert.match(html, /id="routingRuleRoute"[\s\S]*value="campus"[\s\S]*value="direct"/);
  assert.match(html, /id="routingRuleError"[^>]*role="alert"/);
  assert.match(app, /window\.api\.listRoutingRules\(\)/);
  assert.match(app, /window\.api\.saveRoutingRule\(payload\)/);
  assert.match(app, /window\.api\.deleteRoutingRule\(\{[\s\S]{0,120}host: rule\.host,[\s\S]{0,120}includeSubdomains: rule\.includeSubdomains/);
  assert.match(app, /payload\.previous\s*=\s*\{/,
    'editing a host or scope must carry its previous stable identity');
  assert.match(app, /pendingRoutingDeleteKey/,
    'destructive deletion must require an explicit second click');
  assert.match(app, /window\.api\.onOpenRoutingRules\?\.\(\(\) => \{[\s\S]{0,160}setPage\('tower'\);[\s\S]{0,160}openRoutingRuleManager\(\)/,
    'the campus browser can request the same manager without sending page data');
  assert.doesNotMatch(html, /(?:routing|rule)[^>]{0,50}(?:import|export|sync)/i);
});

test('certificate manager reveals only origin, fingerprint, timestamp, and revoke controls', () => {
  assert.match(html, /<dialog id="certificatePinsDialog"[^>]*aria-labelledby="certificatePinsTitle"[^>]*aria-describedby="certificatePinsDescription"/);
  assert.match(html, /id="certificatePinList"[^>]*role="list"[^>]*data-i18n-attr="aria-label:certificates\.listLabel"/);
  assert.match(html, /id="certificatePinError"[^>]*role="alert"/);
  assert.match(app, /window\.api\.listCertificatePins\(\)/);
  assert.match(app, /window\.api\.deleteCertificatePin\(\{[\s\S]{0,120}origin: pin\.origin,[\s\S]{0,120}fingerprint: pin\.fingerprint/);
  assert.match(app, /pin\.origin/);
  assert.match(app, /pin\.fingerprint/);
  assert.match(app, /formatManagerTime\(pin\.updatedAt\)/);
  assert.match(app, /pendingCertificateOrigin/,
    'revocation must require an explicit second click');
  const certificateRenderer = app.slice(
    app.indexOf('function renderCertificatePinList()'),
    app.indexOf('function setCertificatePinBusy'),
  );
  assert.doesNotMatch(certificateRenderer, /issuer|subject|certificate(?:Data|Pem)|serial/i);
});

test('manager layout scrolls inside small windows and preserves keyboard focus visibility', () => {
  assert.match(css, /\.manager-dialog\s*\{[^}]*inset:\s*48px 12px 12px[^}]*overflow:\s*hidden/);
  assert.match(css, /\.manager-body\s*\{[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/);
  assert.match(css, /button:focus-visible[\s\S]*outline:/);
  assert.match(css, /@media\s*\(max-width:\s*619px\)[\s\S]*\.manager-item\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('all server-provided policy values are escaped before dynamic markup', () => {
  const ruleRenderer = app.slice(
    app.indexOf('function renderRoutingRuleList()'),
    app.indexOf('function updateRoutingRuleFormMode'),
  );
  assert.match(ruleRenderer, /esc\(rule\.host\)/);
  assert.match(ruleRenderer, /esc\(t\('routing\.updated'/);
  const pinRenderer = app.slice(
    app.indexOf('function renderCertificatePinList()'),
    app.indexOf('function setCertificatePinBusy'),
  );
  assert.match(pinRenderer, /esc\(pin\.origin\)/);
  assert.match(pinRenderer, /esc\(pin\.fingerprint\)/);
  assert.match(pinRenderer, /esc\(t\('certificates\.updated'/);
});
