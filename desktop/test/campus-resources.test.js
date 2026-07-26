'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadCampusResources, normalizeResource } = require('../lib/campus-resources');

test('bundled campus resources are unique reviewed HTTPS links', () => {
  const resources = loadCampusResources();
  assert.ok(resources.length >= 3);
  assert.equal(new Set(resources.map((resource) => resource.id)).size, resources.length);
  for (const resource of resources) {
    assert.match(resource.url, /^https:\/\/[^/]+/);
    assert.ok(resource.name.length > 0);
  }
});

test('invalid or executable resource entries are rejected', () => {
  assert.equal(normalizeResource({ id: 'bad space', name: 'Bad', url: 'https://example.com' }), null);
  assert.equal(normalizeResource({ id: 'bad', name: 'Bad', url: 'javascript:alert(1)' }), null);
});
