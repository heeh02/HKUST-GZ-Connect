'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { resolveUserDataOverride } = require('../lib/app-data-dir');

test('missing or blank app-data override uses Electron defaults', () => {
  assert.equal(resolveUserDataOverride(undefined), null);
  assert.equal(resolveUserDataOverride(''), null);
  assert.equal(resolveUserDataOverride('   '), null);
});

test('app-data override must be an absolute normalized path', () => {
  const candidate = path.join(path.sep, 'tmp', 'hkustgz-test-profile', '..', 'isolated');
  assert.equal(resolveUserDataOverride(candidate), path.resolve(candidate));
  assert.throws(
    () => resolveUserDataOverride('relative-test-profile'),
    /HKUSTGZ_USER_DATA_DIR must be an absolute path/,
  );
});
