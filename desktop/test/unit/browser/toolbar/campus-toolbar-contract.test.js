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
  assert.deepEqual(normalizeToolbarCommand('navigate', 'https://example.com/'), {
    command: 'navigate', value: 'https://example.com/',
  });
  assert.deepEqual(normalizeToolbarCommand('open-external', 'ignored'), {
    command: 'open-external', value: '',
  });
  assert.equal(normalizeToolbarCommand('execute-javascript', 'alert(1)'), null);
  assert.equal(normalizeToolbarCommand('switch-tab', '-1'), null);
  assert.equal(normalizeToolbarCommand('set-route', 'system'), null);
  assert.equal(normalizeToolbarCommand('navigate', 'x'.repeat(2049)), null);
  assert.equal(normalizeToolbarCommand('find', 'bad\u0000query'), null);
});

test('routing-rule management is an explicit value-free toolbar command', () => {
  assert.deepEqual(normalizeToolbarCommand('manage-routing-rules', { unexpected: true }), {
    command: 'manage-routing-rules', value: '',
  });
});
