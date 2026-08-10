'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateLoginProgress } = require('../lib/login-flow');
const fs = require('node:fs');
const path = require('node:path');

test('login keeps the password while the engine is connecting', () => {
  assert.deepEqual(
    evaluateLoginProgress(true, { connecting: true, connected: false, lastError: null }),
    { pending: true, view: 'login', clearPassword: false, error: '正在连接…' },
  );
});

test('login clears the field only after the tunnel is connected', () => {
  assert.deepEqual(
    evaluateLoginProgress(true, { connecting: false, connected: true, lastError: null }),
    { pending: false, view: 'dash', clearPassword: true, error: '' },
  );
});

test('failed login returns to the form without losing the password', () => {
  assert.deepEqual(
    evaluateLoginProgress(true, { connecting: false, connected: false, lastError: '账号或密码错误' }),
    { pending: false, view: 'login', clearPassword: false, error: '账号或密码错误' },
  );
});

test('renderer handles a rejected password-save IPC without clearing the form', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  assert.match(source, /try\s*\{\s*saved\s*=\s*await window\.api\.save\(\{ username: u, password: p \}\)/s);
  assert.match(source, /catch \(error\)\s*\{\s*\$\('lgErr'\)\.textContent/s);
  assert.doesNotMatch(source, /catch \(error\)[\s\S]{0,180}\$\('lgPass'\)\.value\s*=\s*''/);
});
