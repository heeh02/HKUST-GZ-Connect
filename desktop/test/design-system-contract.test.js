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

test('responsive product contract keeps two columns at 420 and three at the wide breakpoint', () => {
  assert.match(controlCss, /\.resource-grid\s*\{[^}]*repeat\(2,/u);
  assert.match(controlCss, /@media\s*\(min-width:\s*620px\)[\s\S]*\.resource-grid\s*\{[^}]*repeat\(3,/u);
  assert.match(controlCss, /@media\s*\(max-width:\s*379px\)[\s\S]*\.resource-grid\s*\{[^}]*1fr/u);
});
