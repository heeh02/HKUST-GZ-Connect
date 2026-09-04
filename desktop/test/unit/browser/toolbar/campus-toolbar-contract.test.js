'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeToolbarCommand } = require('../../../../lib/browser/toolbar/campus-toolbar-contract');

test('toolbar commands are a small typed allowlist with bounded values', () => {
  assert.deepEqual(normalizeToolbarCommand('back', 'ignored'), { command: 'back', value: '' });
  assert.deepEqual(normalizeToolbarCommand('switch-tab', '12'), { command: 'switch-tab', value: 12 });
  assert.deepEqual(normalizeToolbarCommand('set-route', 'direct'), {
    command: 'set-route', value: 'direct',
  });
  assert.deepEqual(normalizeToolbarCommand('set-route', 'auto'), {
    command: 'set-route', value: 'auto',
  });
  assert.deepEqual(normalizeToolbarCommand('navigate', 'https://example.com/'), {
    command: 'navigate', value: 'https://example.com/',
  });
  assert.deepEqual(normalizeToolbarCommand('open-settings', 'ignored'), {
    command: 'open-settings', value: '',
  });
  assert.deepEqual(normalizeToolbarCommand('toggle-favorite', 'ignored'), {
    command: 'toggle-favorite', value: '',
  });
  assert.deepEqual(normalizeToolbarCommand('focus-workspace', 'ignored'), {
    command: 'focus-workspace', value: '',
  });
  assert.deepEqual(normalizeToolbarCommand('manage-bookmarks', 'ignored'), {
    command: 'manage-bookmarks', value: '',
  });
  assert.deepEqual(normalizeToolbarCommand('open-bookmark-menu', 'ignored'), {
    command: 'open-bookmark-menu', value: '',
  });
  assert.deepEqual(normalizeToolbarCommand('open-bookmark-folder', 'group_abcdefghijkl'), {
    command: 'open-bookmark-folder', value: 'group_abcdefghijkl',
  });
  assert.equal(normalizeToolbarCommand('open-bookmark-folder', '../group'), null);
  assert.deepEqual(normalizeToolbarCommand('open-resource', 'canvas'), {
    command: 'open-resource', value: 'canvas',
  });
  assert.equal(normalizeToolbarCommand('open-resource', '../canvas'), null);
  assert.equal(normalizeToolbarCommand('execute-javascript', 'alert(1)'), null);
  assert.equal(normalizeToolbarCommand('switch-tab', '-1'), null);
  assert.equal(normalizeToolbarCommand('set-route', 'system'), null);
  assert.equal(normalizeToolbarCommand('navigate', 'x'.repeat(2049)), null);
  assert.equal(normalizeToolbarCommand('find', 'bad\u0000query'), null);
});

test('low-frequency routing-rule management is not exposed by the browser toolbar', () => {
  assert.equal(normalizeToolbarCommand('manage-routing-rules', { unexpected: true }), null);
});
