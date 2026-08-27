'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { layoutForWidth, normalizeLayout } = require('../renderer/resource-layout-policy');

test('resource layout follows the campus-service container instead of the display', () => {
  assert.deepEqual(layoutForWidth(0), {
    mode: 'compact', columns: 2, sectionLimit: 4,
  });
  assert.deepEqual(layoutForWidth(459), {
    mode: 'compact', columns: 2, sectionLimit: 4,
  });
  assert.deepEqual(layoutForWidth(460), {
    mode: 'standard', columns: 3, sectionLimit: 6,
  });
  assert.deepEqual(layoutForWidth(719), {
    mode: 'standard', columns: 3, sectionLimit: 6,
  });
  assert.deepEqual(layoutForWidth(720), {
    mode: 'wide', columns: 4, sectionLimit: 8,
  });
  assert.deepEqual(layoutForWidth(1400), {
    mode: 'wide', columns: 4, sectionLimit: 8,
  });
});

test('resource layout fails closed to compact immutable values', () => {
  const compact = layoutForWidth(Number.NaN);
  assert.equal(Object.isFrozen(compact), true);
  assert.equal(normalizeLayout({ mode: 'unknown', columns: 99, sectionLimit: 99 }), compact);
  assert.equal(normalizeLayout({ mode: 'wide' }), layoutForWidth(720));
});
