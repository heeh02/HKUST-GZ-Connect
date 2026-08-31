'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const categoryStacks = require('../renderer/campus-category-stacks');
const { balancedPartitions, getLayoutCapacity } = categoryStacks;
const stackedCardLayout = require('../renderer/stacked-card-layout');

test('official task categories and personal folders remain separate projections', () => {
  const resources = [
    { id: 'portal', name: 'Portal', reviewed: true, category: 'gateway', favorite: true },
    { id: 'sis', name: 'SIS', reviewed: true, category: 'courses', favorite: true },
    { id: 'apr', name: 'APR', reviewed: true, category: 'research', favorite: false },
    { id: 'custom', name: 'Custom', reviewed: false, category: 'custom', favorite: true },
  ];
  const translate = (key) => key;
  const official = categoryStacks.officialCategoryProjection(resources, translate);
  assert.deepEqual(official.map(({ id }) => id), ['gateway', 'courses', 'research']);
  assert.deepEqual(official.map(({ items }) => items.map(({ id }) => id)), [
    ['portal'], ['sis'], ['apr'],
  ]);
  const personal = categoryStacks.personalCategoryProjection(resources, [{
    id: 'study', name: 'Study', resourceIds: ['sis'],
  }], translate);
  assert.deepEqual(personal.map(({ id }) => id), ['ungrouped-favorites', 'study']);
  assert.deepEqual(personal.map(({ kind }) => kind), ['system-widget', 'user-collection']);
  assert.deepEqual(personal[0].items.map(({ id }) => id), ['portal', 'custom']);
});

test('responsive capacity follows the shared logical card-board grid', () => {
  assert.equal(balancedPartitions, stackedCardLayout.balancedPartitions,
    'Campus Browser and routing rules share one stack partition implementation');
  assert.deepEqual(getLayoutCapacity(655, 640), { columns: 1, rows: 1, slotCount: 1 });
  assert.deepEqual(getLayoutCapacity(656, 640), { columns: 2, rows: 1, slotCount: 2 });
  assert.deepEqual(getLayoutCapacity(991, 699), { columns: 2, rows: 1, slotCount: 2 });
  assert.deepEqual(getLayoutCapacity(992, 700), { columns: 3, rows: 2, slotCount: 6 });
  assert.deepEqual(getLayoutCapacity(1352, 700), { columns: 4, rows: 2, slotCount: 8 });
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

test('a custom Profile with no reviewed catalogue retains personal categories', () => {
  const resources = [
    { id: 'custom', name: 'Custom', reviewed: false, favorite: true },
  ];
  assert.deepEqual(categoryStacks.officialCategoryProjection(resources, (key) => key), []);
  const personal = categoryStacks.personalCategoryProjection(resources, [{
    id: 'study', name: 'Study', resourceIds: ['custom'],
  }], (key) => key);
  assert.deepEqual(personal.map(({ id, kind }) => ({ id, kind })), [{
    id: 'study', kind: 'user-collection',
  }]);
});
