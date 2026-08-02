'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererDir = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(rendererDir, 'styles.css'), 'utf8');

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
