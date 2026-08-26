'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { suggestedResourceName } = require('../renderer/resource-manager');

test('resource name suggestion accepts only HTTP(S) host input', () => {
  assert.equal(suggestedResourceName('example.test/path'), 'example.test');
  assert.equal(suggestedResourceName('https://Campus.Example.Test/x'), 'campus.example.test');
  assert.equal(suggestedResourceName('file:///tmp/private'), '');
  assert.equal(suggestedResourceName('javascript:alert(1)'), '');
});

test('resource editor escapes dynamic values and retains explicit two-click deletion', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'renderer', 'resource-manager.js'),
    'utf8',
  );
  const render = source.slice(
    source.indexOf('function renderList()'),
    source.indexOf('async function open()'),
  );
  assert.match(render, /esc\(resource\.id\)/);
  assert.match(render, /esc\(resource\.name\)/);
  assert.match(render, /esc\(routeLabel\(resource, translate\)\)/);
  assert.match(source, /pendingDeleteId !== resource\.id/);
  assert.match(source, /api\.deleteResource\(resource\.id\)/);
  assert.match(source, /api\.restoreBuiltinResources\(\)/);
  assert.match(render, /!custom/);
  assert.match(source, /api\.reorderResources\(localIds\)/);
});
