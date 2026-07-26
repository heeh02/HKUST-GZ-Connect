'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { exactExecutablePattern } = require('../lib/engine-process');

test('orphan cleanup matches only the resolved engine executable', () => {
  const pattern = new RegExp(exactExecutablePattern('/tmp/build+test/ec-engine'));
  assert.equal(pattern.test('/tmp/build+test/ec-engine --config profile.json'), true);
  assert.equal(pattern.test('cargo build --bin ec-engine'), false);
  assert.equal(pattern.test('/other/ec-engine --config profile.json'), false);
});
