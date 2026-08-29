'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = path.join(__dirname, '..', 'renderer');
const tokens = fs.readFileSync(path.join(renderer, 'design-tokens.css'), 'utf8');
const controlHtml = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const browserHtml = fs.readFileSync(path.join(renderer, 'campus-browser.html'), 'utf8');
const controlCss = fs.readFileSync(path.join(renderer, 'styles.css'), 'utf8');
const connectionCss = fs.readFileSync(path.join(renderer, 'styles', 'connection-strip.css'), 'utf8');
const productCss = fs.readFileSync(path.join(renderer, 'styles', 'product-shell.css'), 'utf8');
const browserCss = fs.readFileSync(path.join(renderer, 'campus-browser.css'), 'utf8');

test('control panel and Campus Browser share one bounded design-token vocabulary', () => {
  for (const token of [
    '--color-brand-navy',
    '--color-brand-gold',
    '--space-4',
    '--radius-card',
    '--motion-standard',
    '--shadow-lg',
  ]) assert.match(tokens, new RegExp(`${token}:`, 'u'));
  for (const html of [controlHtml, browserHtml]) {
    const tokensAt = html.indexOf('design-tokens.css');
    const surfaceAt = html.indexOf(html === controlHtml ? 'styles.css' : 'campus-browser.css');
    assert.ok(tokensAt > 0 && tokensAt < surfaceAt, 'design tokens must load before surface CSS');
  }
  assert.ok(controlHtml.indexOf('styles.css') < controlHtml.indexOf('styles/connection-strip.css'),
    'connection strip module must load after the shared control shell');
  assert.ok(controlHtml.indexOf('styles/connection-strip.css') < controlHtml.indexOf('styles/product-shell.css'),
    'the product information architecture must be the final control surface authority');
  assert.doesNotMatch(controlCss, /^:root\s*\{/u, 'control CSS must not redefine shared tokens');
  assert.match(browserCss, /var\(--radius-control\)/u);
  assert.match(browserCss, /var\(--motion-fast\)/u);
});

test('personal Campus Browser uses responsive category stacks without website-card nesting', () => {
  assert.match(productCss, /\.category-stack-grid\s*\{[^}]*repeat\(var\(--stack-columns/u);
  assert.match(productCss, /\.stacked-category-tab\s*\{[^}]*height:\s*38px/u);
  assert.match(productCss, /\.category-card\s*\{[^}]*border-radius:\s*16px/u);
  assert.match(productCss, /\.category-site\s*\{[^}]*border-bottom:\s*1px solid/u);
  assert.match(productCss, /\.category-site-icon\s*\{[^}]*width:\s*30px[^}]*height:\s*30px/u);
  assert.match(controlHtml, /data-page="browser"/u);
  assert.match(controlHtml, /id="resourceSearch"/u);
  assert.match(controlHtml, /id="campusResources"[^>]*class="category-stack-grid"/u);
  assert.doesNotMatch(controlHtml, /data-page="connect"[\s\S]*id="resourceShelf"[\s\S]*data-page="browser"/u);
});

test('connection-first shell preserves restrained brand controls and progressive disclosure', () => {
  assert.match(controlCss, /\.titlebar\s*\{[^}]*justify-content:\s*center[^}]*1\.5px solid var\(--gold\)/u);
  assert.match(controlCss, /\.sidebar\s*\{[^}]*flex:\s*0 0 70px/u);
  assert.match(controlCss, /\.nav\.active\s*\{[^}]*box-shadow:\s*0 4px 14px/u);
  assert.match(productCss, /\.connection-layout\s*\{[^}]*grid-template-columns:/u);
  assert.match(productCss, /\.network-topology\s*\{[^}]*border-radius:\s*18px/u);
  assert.doesNotMatch(controlCss, /\.hero-card|\.connection-action/u,
    'connection ownership must not drift back into the shared stylesheet');
  assert.match(controlHtml, /id="power"[^>]*class="connection-action"|class="connection-action"[^>]*id="power"/u);
  assert.match(controlHtml, /id="power"[^>]*role="switch"|role="switch"[^>]*id="power"/u);
  assert.match(productCss, /#power\.connection-action\s*\{[^}]*width:\s*52px[^}]*height:\s*29px/u);
  assert.match(controlHtml, /id="notificationDrawer"[^>]*role="dialog"/u);
  assert.doesNotMatch(controlHtml, /class="nav" data-page="notif"/u);
  assert.match(controlCss, /\.resource-favorite:hover,\s*\.resource-favorite\.active\s*\{[^}]*background:\s*transparent/u);
  assert.match(controlCss, /\.logs\s*\{[^}]*min-height:\s*320px[^}]*max-height:\s*420px/u);
  assert.doesNotMatch(controlHtml, /class="help-section"/u);
  assert.match(browserCss, /\.icon\s*\{[^}]*border:\s*0/u);
  assert.match(browserCss, /\.state\.loading\s*\{[^}]*display:\s*block/u);
  assert.ok(browserHtml.indexOf('id="address"') < browserHtml.indexOf('id="routeBadge"'),
    'the route state belongs at the trailing edge of the address field');
  assert.match(browserHtml, /id="browserSettings"/u);
});
