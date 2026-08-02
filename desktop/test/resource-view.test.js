'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { routeLabel, visibleResources } = require('../lib/resource-view');

test('website shelf shows a compact pinned subset until expanded', () => {
  const resources = Array.from({ length: 6 }, (_, index) => ({ id: String(index) }));
  assert.deepEqual(visibleResources(resources, false).map((item) => item.id), ['0', '1', '2', '3']);
  assert.equal(visibleResources(resources, true).length, 6);
});

test('route labels distinguish tunnel and direct shortcuts', () => {
  assert.equal(routeLabel({ route: 'campus' }), '校园隧道');
  assert.equal(routeLabel({ route: 'direct' }), '直连');
});
