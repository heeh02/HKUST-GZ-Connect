'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyEngineOutput, engineFailureKind } = require('../lib/engine-output');

test('native engine authentication failure is terminal and user-readable', () => {
  const message = classifyEngineOutput('ec-engine: gateway authentication failed', 1080);
  assert.match(message, /账号或密码错误/);
  assert.match(message, /停止自动重试/);
});

test('bind and authentication-method failures remain distinguishable', () => {
  assert.match(classifyEngineOutput('address already in use', 2080), /2080/);
  assert.match(classifyEngineOutput('Not implemented auth', 1080), /SSO\/MFA/);
  assert.equal(classifyEngineOutput('SOCKS5 server listening', 1080), null);
});

test('address allocation rejection is transient and user-readable', () => {
  const oldEngine = 'ec-engine: modern address reply has an unexpected status';
  const currentEngine = 'ec-engine: modern address reply rejected the request (status=3)';
  assert.match(classifyEngineOutput(oldEngine, 1080), /自动重试/);
  assert.match(classifyEngineOutput(currentEngine, 1080), /清理会话/);
  assert.equal(engineFailureKind(oldEngine), 'gateway-transient');
  assert.equal(engineFailureKind(currentEngine), 'gateway-transient');
  const shortRead = 'ec-engine: modern address TLS: failed to fill whole buffer';
  assert.match(classifyEngineOutput(shortRead, 1080), /网关通道/);
  assert.equal(engineFailureKind(shortRead), 'gateway-transient');
  assert.equal(engineFailureKind('ec-engine: gateway authentication failed'), 'terminal');
  assert.equal(engineFailureKind('ec-engine: connection reset'), 'unknown');
});
