'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { TabLimitError, TabManager } = require('../lib/tab-manager');

test('tab manager owns monotonic ids and enforces its hard limit', () => {
  const manager = new TabManager({ maxTabs: 2 });
  const first = manager.add({ title: 'first' });
  const second = manager.add({ title: 'second' });
  assert.deepEqual([first.id, second.id], [1, 2]);
  assert.equal(manager.canAdd(), false);
  assert.throws(() => manager.add({ title: 'overflow' }), TabLimitError);

  manager.clear();
  assert.equal(manager.add({ title: 'after-clear' }).id, 3,
    'closed tabs must not make a stale toolbar command target a reused id');
});

test('closing the active tab selects the neighbor at the same visual position', () => {
  const manager = new TabManager({ maxTabs: 4 });
  const first = manager.add({ title: 'first' });
  const second = manager.add({ title: 'second' });
  const third = manager.add({ title: 'third' });
  manager.select(second.id);

  const middleRemoval = manager.remove(second.id);
  assert.equal(middleRemoval.replacement, third);
  assert.equal(manager.active(), third);

  const endRemoval = manager.remove(third.id);
  assert.equal(endRemoval.replacement, first);
  assert.equal(manager.active(), first);

  const finalRemoval = manager.remove(first.id);
  assert.equal(finalRemoval.empty, true);
  assert.equal(manager.activeTabId, null);
  assert.equal(manager.active(), null);
});

test('closing a background tab leaves the active tab and selection untouched', () => {
  const manager = new TabManager({ maxTabs: 3 });
  const first = manager.add({ title: 'first' });
  const second = manager.add({ title: 'second' });
  manager.select(second.id);
  const removal = manager.remove(first.id);
  assert.equal(removal.wasActive, false);
  assert.equal(removal.replacement, null);
  assert.equal(manager.active(), second);
});

test('tab replacement preserves identity and active selection', () => {
  const manager = new TabManager();
  const original = manager.add({ title: 'before' });
  manager.select(original.id);
  const replacement = { title: 'after' };
  const result = manager.replace(original.id, replacement);
  assert.equal(result.previous, original);
  assert.equal(result.replacement, replacement);
  assert.equal(result.active, true);
  assert.equal(replacement.id, original.id);
  assert.equal(manager.active(), replacement);
});

test('replaceAll supports the CampusBrowser compatibility surface safely', () => {
  const manager = new TabManager({ maxTabs: 3 });
  const existing = { id: 8, title: 'existing' };
  const allocated = { title: 'allocated' };
  manager.replaceAll([existing, allocated], { activeTabId: 8 });
  assert.equal(manager.active(), existing);
  assert.equal(allocated.id, 1);
  assert.equal(manager.add({ title: 'next' }).id, 9);
  assert.throws(() => manager.replaceAll([{ id: 4 }, { id: 4 }]), /unique/);
});
