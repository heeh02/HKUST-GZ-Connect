'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { balancedPartitions, getLayoutCapacity } = require('../renderer/campus-category-stacks');

test('responsive capacity keeps six categories in three stable stacks before tall expansion', () => {
  assert.deepEqual(getLayoutCapacity(1009, 640), { columns: 3, rows: 1, slotCount: 3 });
  assert.deepEqual(getLayoutCapacity(1009, 800), { columns: 3, rows: 2, slotCount: 6 });
  assert.deepEqual(balancedPartitions([1, 2, 3, 4, 5, 6], 3), [[1, 2], [3, 4], [5, 6]]);
  assert.deepEqual(balancedPartitions([1, 2, 3, 4, 5, 6], 6), [[1], [2], [3], [4], [5], [6]]);
});

test('category partitioning is contiguous, balanced, and deterministic', () => {
  const values = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const first = balancedPartitions(values, 3);
  assert.deepEqual(first, [['a', 'b', 'c'], ['d', 'e'], ['f', 'g']]);
  assert.deepEqual(balancedPartitions(values, 3), first);
  assert.ok(Math.max(...first.map((part) => part.length)) - Math.min(...first.map((part) => part.length)) <= 1);
});
