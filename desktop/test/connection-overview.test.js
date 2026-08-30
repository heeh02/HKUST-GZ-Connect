'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildUnderlayOptions, sparkline } = require('../renderer/connection-overview');

test('latency sparkline is bounded and stable for empty and noisy samples', () => {
  assert.equal(sparkline([]), 'M2 24 L118 24');
  const path = sparkline([18, 22, 19, 4000, -2]);
  assert.match(path, /^M2\.0 \d+\.\d(?: L\d+\.\d \d+\.\d){4}$/u);
  for (const coordinate of path.match(/\d+\.\d/gu).map(Number)) {
    assert.ok(Number.isFinite(coordinate));
  }
});

test('network tree keeps one default line and selectable physical or virtual alternatives', () => {
  const environment = {
    defaultRoute: { interfaceId: 'en0', sourceAddress: '192.0.2.10' },
    selection: { mode: 'default', interfaceId: 'en0', sourceAddress: '', available: true },
    interfaces: [
      { id: 'en0', name: 'Wi-Fi', kind: 'physical', active: true, default: true,
        addresses: [{ address: '192.0.2.10', selectable: true }] },
      { id: 'utun4', name: 'Tailscale', kind: 'virtual', active: true, default: false,
        addresses: [{ address: '100.64.0.2', selectable: true }] },
    ],
  };
  const t = (key) => key;
  const options = buildUnderlayOptions(environment, t);
  assert.deepEqual(options.map(({ value, selected }) => ({ value, selected })), [
    { value: '', selected: true },
    { value: '100.64.0.2', selected: false },
  ]);
  environment.selection = { mode: 'selected', interfaceId: 'utun4',
    sourceAddress: '100.64.0.2', available: true };
  assert.equal(buildUnderlayOptions(environment, t)[1].selected, true);
  environment.selection.available = false;
  assert.equal(buildUnderlayOptions(environment, t).some(({ selected }) => selected), false);
});

test('connection overview exposes one interactive network tree instead of duplicate cards and select', () => {
  const renderer = path.join(__dirname, '..', 'renderer');
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');
  for (const id of ['networkTree', 'underlayTreeOptions', 'systemRouteName', 'systemProxyName']) {
    assert.match(html, new RegExp(`id="${id}"`, 'u'));
  }
  for (const removed of ['defaultAdapterName', 'virtualAdapterSummary', 'underlaySourceAddress']) {
    assert.doesNotMatch(html, new RegExp(`id="${removed}"`, 'u'));
  }
  assert.match(html, /network-tree-branches/u);
  assert.match(html, /data-topology-node="tunnel"/u);
  assert.match(app, /connectionOverview\.start\(\{[^\n]*save:\s*\(patch\)\s*=>\s*window\.api\.save/u);
  assert.match(app, /refresh:\s*\(\)\s*=>\s*refreshState/u);
});
