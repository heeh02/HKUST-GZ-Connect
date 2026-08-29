'use strict';

const assert = require('node:assert/strict');
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
