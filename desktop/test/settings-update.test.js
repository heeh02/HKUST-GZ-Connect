'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applySettingsPatch, parseCredentialField, parsePort } = require('../lib/settings-update');

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

test('the language override is validated like the close action', () => {
  assert.equal(applySettingsPatch({}, { language: 'en' }).settings.language, 'en');
  assert.equal(applySettingsPatch({ language: 'en' }, {}).settings.language, 'en');
  assert.throws(() => applySettingsPatch({}, { language: 'fr' }), /语言/);
});

test('credentials with control characters cannot reframe the engine stdin protocol', () => {
  assert.equal(parseCredentialField('student.name', '账号'), 'student.name');
  assert.equal(parseCredentialField('pass word §', '密码'), 'pass word §');
  for (const injected of ['\n', '\r', '\u0000', '\u007f', '\u2028']) {
    assert.throws(() => applySettingsPatch({}, { username: `alice${injected}bob` }), /账号/);
    assert.throws(() => applySettingsPatch({}, { password: `secret${injected}x` }), /密码/);
  }
});

test('a rejected credential leaves every other setting untouched', () => {
  const previous = { port: 6180, username: 'alice' };
  assert.throws(() => applySettingsPatch(previous, { port: 2080, username: 'bob\nroot' }), /账号/);
  assert.equal(applySettingsPatch(previous, {}).settings.username, 'alice');
});
