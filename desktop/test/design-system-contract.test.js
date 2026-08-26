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

test('2.0.1 desktop density keeps two columns in compact/standard and three in wide', () => {
  assert.match(controlCss, /\.resource-grid\s*\{[^}]*repeat\(2,/u);
  assert.match(controlCss, /@media\s*\(min-width:\s*800px\)[\s\S]*\.resource-grid\s*\{[^}]*repeat\(3,/u);
  assert.match(controlCss, /@media\s*\(max-width:\s*359px\)[\s\S]*\.resource-grid[^}]*1fr/u);
});

test('2.0.1 visual grammar reserves cards and shadows for semantic objects', () => {
  assert.match(controlCss, /\.titlebar\s*\{[^}]*justify-content:\s*flex-start[^}]*rgba\(168,132,44,\.28\)/u);
  assert.match(controlCss, /--sidebar-compact\)/u);
  assert.match(controlCss, /\.nav\.active\s*\{[^}]*box-shadow:\s*none/u);
  assert.match(controlCss, /\.quick-card\s*\{[^}]*border:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/u);
  assert.match(controlCss, /\.tower-card\s*\{[^}]*border-radius:\s*0[^}]*box-shadow:\s*none/u);
  assert.match(controlCss, /\.resource-favorite:hover,\s*\.resource-favorite\.active\s*\{[^}]*background:\s*transparent/u);
  assert.match(controlCss, /\.logs\s*\{[^}]*height:\s*260px[^}]*max-height:\s*260px/u);
  assert.match(controlCss, /\.settings-card\s*\{[^}]*border-bottom:\s*1px solid var\(--line\)[^}]*box-shadow:\s*none/u);
  assert.match(controlHtml, /class="help-section"/u);
  assert.match(browserCss, /\.icon\s*\{[^}]*border:\s*0/u);
  assert.match(browserCss, /\.state\.loading\s*\{[^}]*display:\s*block/u);
  assert.ok(browserHtml.indexOf('id="address"') < browserHtml.indexOf('id="routeBadge"'),
    'the route state belongs at the trailing edge of the address field');
  assert.match(browserHtml, /id="openExternal"/u);
});
