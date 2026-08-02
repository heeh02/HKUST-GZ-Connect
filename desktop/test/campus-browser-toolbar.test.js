'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'campus-browser.html'), 'utf8');
const js = fs.readFileSync(path.join(renderer, 'campus-browser.js'), 'utf8');

test('browser toolbar exposes the active tab network route', () => {
  assert.match(html, /id="routeSelector"/);
  assert.match(html, /value="campus"/);
  assert.match(html, /value="direct"/);
  assert.match(js, /command\('set-route'/);
});
