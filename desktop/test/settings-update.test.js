'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applySettingsPatch, parsePort } = require('../lib/settings-update');

test('numeric-string Windows port is preserved as an integer', () => {
  const result = applySettingsPatch({ port: 1080 }, { port: '6180' });
  assert.equal(result.settings.port, 6180);
  assert.equal(result.portChanged, true);
});

test('saving the current port does not request another reconnect', () => {
  const result = applySettingsPatch({ port: 6180 }, { port: 6180 });
  assert.equal(result.settings.port, 6180);
  assert.equal(result.portChanged, false);
});

test('invalid and empty ports fail instead of silently restoring 1080', () => {
  assert.throws(() => parsePort(''), /不能为空/);
  assert.throws(() => parsePort('6180x'), /1025/);
  assert.throws(() => parsePort(80), /1025/);
});

test('invalid retry count fails instead of changing another setting', () => {
  assert.throws(
    () => applySettingsPatch({ port: 6180 }, { maxAttempts: 'not-a-number' }),
    /重试次数/,
  );
});
