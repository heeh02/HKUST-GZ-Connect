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
  assert.doesNotMatch(controlCss, /^:root\s*\{/u, 'control CSS must not redefine shared tokens');
  assert.match(browserCss, /var\(--radius-control\)/u);
  assert.match(browserCss, /var\(--motion-fast\)/u);
});

test('2.0.1 portal shelf grows from two columns into modular three and four-column layouts', () => {
  assert.match(controlCss, /\.resource-grid\s*\{[^}]*repeat\(2,/u);
  assert.match(controlCss, /data-resource-layout="standard"[^}]*[\s\S]{0,80}repeat\(3,/u);
  assert.match(controlCss, /data-resource-layout="wide"[\s\S]{0,900}repeat\(4,/u);
  assert.match(controlCss, /@media\s*\(max-width:\s*359px\)[\s\S]*\.resource-grid[^}]*1fr/u);
  assert.match(controlCss, /\.resource-link\s*\{[^}]*grid-template-columns:\s*38px minmax\(0, 1fr\)[^}]*border:\s*0/u);
  assert.match(controlCss, /\.resource-card\s*\{[^}]*border-bottom:\s*1px solid var\(--line\)/u);
  assert.match(controlCss, /\.resource-icon\s*\{[^}]*position:\s*relative[^}]*width:\s*38px[^}]*background:\s*#e9edf3/u);
  assert.match(controlCss, /\.resource-route-short\s*\{[^}]*position:\s*absolute/u);
  assert.match(controlHtml, /id="resourceViewChips"/u);
  assert.match(controlCss, /\.resource-view-chips\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/u);
  assert.match(controlHtml, /id="resourceView"[^>]*hidden[^>]*tabindex="-1"/u);
  assert.match(controlHtml, /EasyConnect[\s\S]{0,100}connect\.easyConnectCompatible/u);
});

test('2.0.1 restores the compact classic shell while avoiding nested website cards', () => {
  assert.match(controlCss, /\.titlebar\s*\{[^}]*justify-content:\s*center[^}]*1\.5px solid var\(--gold\)/u);
  assert.match(controlCss, /\.sidebar\s*\{[^}]*flex:\s*0 0 70px/u);
  assert.match(controlCss, /\.nav\.active\s*\{[^}]*box-shadow:\s*0 4px 14px/u);
  assert.match(controlCss, /\.quick-card\s*\{[^}]*border:\s*1px solid var\(--gold-soft\)[^}]*box-shadow:\s*var\(--shadow\)/u);
  assert.match(controlCss, /\.hero-card\s*\{[^}]*flex-direction:\s*column[^}]*border-radius:\s*20px/u);
  assert.match(controlCss, /\.resource-favorite:hover,\s*\.resource-favorite\.active\s*\{[^}]*background:\s*transparent/u);
  assert.match(controlCss, /\.logs\s*\{[^}]*min-height:\s*320px[^}]*max-height:\s*420px/u);
  assert.doesNotMatch(controlHtml, /class="help-section"/u);
  assert.match(browserCss, /\.icon\s*\{[^}]*border:\s*0/u);
  assert.match(browserCss, /\.state\.loading\s*\{[^}]*display:\s*block/u);
  assert.ok(browserHtml.indexOf('id="address"') < browserHtml.indexOf('id="routeBadge"'),
    'the route state belongs at the trailing edge of the address field');
  assert.match(browserHtml, /id="openExternal"/u);
});
