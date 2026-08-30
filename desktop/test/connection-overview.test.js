'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { sparkline } = require('../renderer/connection-overview');

test('latency sparkline is bounded and stable for empty and noisy samples', () => {
  assert.equal(sparkline([]), 'M2 24 L118 24');
  const path = sparkline([18, 22, 19, 4000, -2]);
  assert.match(path, /^M2\.0 \d+\.\d(?: L\d+\.\d \d+\.\d){4}$/u);
  for (const coordinate of path.match(/\d+\.\d/gu).map(Number)) {
    assert.ok(Number.isFinite(coordinate));
  }
});

test('connection overview exposes one cross-platform network environment and underlay control', () => {
  const renderer = path.join(__dirname, '..', 'renderer');
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');
  for (const id of ['defaultAdapterName', 'systemRouteName', 'systemProxyName',
    'virtualAdapterSummary', 'underlaySourceAddress']) {
    assert.match(html, new RegExp(`id="${id}"`, 'u'));
  }
  assert.match(app, /connectionOverview\.start\(\{[^\n]*save:\s*\(patch\)\s*=>\s*window\.api\.save/u);
  assert.match(app, /refresh:\s*\(\)\s*=>\s*refreshState/u);
});
