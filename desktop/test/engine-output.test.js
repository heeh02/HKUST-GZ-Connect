'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyEngineCode,
  classifyEngineOutput,
  engineFailureKind,
  engineFailureKindFromCode,
} = require('../lib/engine-output');

test('native engine authentication failure is terminal and user-readable', () => {
  const message = classifyEngineOutput('ec-engine: gateway authentication failed', 1080);
  assert.match(message, /账号或密码错误/);
  assert.match(message, /停止自动重试/);
});

test('structured engine error codes are stable, readable and classify retry safety', () => {
  assert.match(classifyEngineCode('AUTH_FAILED', 1080), /账号或密码错误/);
  assert.match(classifyEngineCode('LOCAL_LISTENER_FAILED', 6180), /6180/);
  assert.match(classifyEngineCode('CONFIGURATION_INVALID', 1080), /配置无效/);
  assert.equal(engineFailureKindFromCode('AUTH_FAILED'), 'terminal');
  assert.equal(engineFailureKindFromCode('NETWORK_DISCONNECTED'), 'gateway-transient');
  assert.equal(engineFailureKindFromCode('LOCAL_LISTENER_FAILED'), 'terminal');
});

test('unsupported MFA is distinct from a wrong password and never retried', () => {
  assert.equal(
    classifyEngineCode('UNSUPPORTED_AUTHENTICATION', 6180),
    '网关鉴权方式不受支持（可能已改为 SSO/MFA）',
  );
  assert.equal(engineFailureKindFromCode('UNSUPPORTED_AUTHENTICATION'), 'terminal');
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
