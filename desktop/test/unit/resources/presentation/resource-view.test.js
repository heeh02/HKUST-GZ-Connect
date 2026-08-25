'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  filteredResources,
  routeLabel,
  visibleResources,
} = require('../../../../lib/resources/presentation/resource-view');

test('website shelf shows a compact pinned subset until expanded', () => {
  const resources = Array.from({ length: 6 }, (_, index) => ({ id: String(index) }));
  assert.deepEqual(visibleResources(resources, false).map((item) => item.id), ['0', '1', '2', '3']);
  assert.equal(visibleResources(resources, true).length, 6);
});

test('route labels distinguish tunnel and direct shortcuts', () => {
  assert.equal(routeLabel({ route: 'campus' }), '校园隧道');
  assert.equal(routeLabel({ route: 'direct' }), '直连');
  assert.equal(routeLabel({ route: 'campus' }, (key) => `translated:${key}`),
    'translated:resources.routeCampus');
  assert.equal(routeLabel({ route: 'direct' }, (key) => `translated:${key}`),
    'translated:resources.routeDirect');
});

test('resource search covers metadata while category favorites and recent views stay deterministic', () => {
  const resources = [
    { id: 'home', name: '学校主页', description: 'Campus news', url: 'https://a.test/',
      category: 'campus-service', keywords: ['HKUST'], favorite: false, lastOpenedAt: 10 },
    { id: 'canvas', name: 'Canvas', description: 'Courses', url: 'https://b.test/',
      category: 'academic', keywords: ['作业'], favorite: true, lastOpenedAt: 30 },
    { id: 'mail', name: 'Outlook', description: 'Email', url: 'https://c.test/',
      category: 'common', keywords: [], favorite: true, lastOpenedAt: 20 },
  ];
  assert.deepEqual(filteredResources(resources, { query: '作业' }).map(({ id }) => id), ['canvas']);
  assert.deepEqual(filteredResources(resources, { view: 'favorites' }).map(({ id }) => id), ['canvas', 'mail']);
  assert.deepEqual(filteredResources(resources, { view: 'recent' }).map(({ id }) => id), ['canvas', 'mail', 'home']);
  assert.deepEqual(filteredResources(resources, { view: 'academic' }).map(({ id }) => id), ['canvas']);
  assert.deepEqual(filteredResources(resources, { view: 'unknown' }).map(({ id }) => id), ['home', 'canvas', 'mail']);
});
