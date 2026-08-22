'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyEngineCode,
  classifyEngineOutput,
  classifyEngineStopReason,
  engineFailureKind,
  engineFailureKindFromCode,
  engineFailureKindFromStopReason,
  resolveEngineFailureKind,
} = require('../lib/engine-output');

test('native engine authentication failure is terminal and user-readable', () => {
  const message = classifyEngineOutput('ec-engine: gateway authentication failed', 1080);
  assert.match(message, /无法确认是否为密码问题/);
  assert.match(message, /停止自动重试/);
});

test('structured engine error codes are stable, readable and classify retry safety', () => {
  assert.match(classifyEngineCode('AUTH_FAILED', 1080), /无法确认是否为密码问题/);
  assert.match(classifyEngineCode('AUTH_REJECTED', 1080), /账号或密码未被网关接受/);
  assert.match(classifyEngineCode('AUTH_INDETERMINATE', 1080), /结果无法确认/);
  assert.doesNotMatch(classifyEngineCode('AUTH_INDETERMINATE', 1080), /密码错误/);
  assert.match(classifyEngineCode('AUTH_PROTOCOL_INVALID', 1080), /响应.*不兼容/);
  assert.match(classifyEngineCode('AUTH_LIMIT_EXCEEDED', 1080), /安全上限/);
  assert.match(
    classifyEngineCode('AUTH_INDETERMINATE', 1080, undefined, 'AUTH_CLEANUP_UNCONFIRMED'),
    /清理未能确认/,
  );
  assert.match(classifyEngineCode('LOCAL_LISTENER_FAILED', 6180), /6180/);
  assert.match(classifyEngineCode('CONFIGURATION_INVALID', 1080), /配置无效/);
  assert.equal(engineFailureKindFromCode('AUTH_FAILED'), 'terminal');
  assert.equal(engineFailureKindFromCode('AUTH_REJECTED'), 'terminal');
  assert.equal(engineFailureKindFromCode('AUTH_INDETERMINATE'), 'terminal');
  assert.equal(engineFailureKindFromCode('AUTH_PROTOCOL_INVALID'), 'terminal');
  assert.equal(engineFailureKindFromCode('AUTH_LIMIT_EXCEEDED'), 'terminal');
  assert.equal(engineFailureKindFromCode('NETWORK_DISCONNECTED'), 'gateway-transient');
  assert.equal(engineFailureKindFromCode('LOCAL_LISTENER_FAILED'), 'terminal');
  assert.match(classifyEngineCode('DATA_PLANE_SHUTDOWN_FAILED', 1080), /停止自动重连/);
  assert.equal(engineFailureKindFromCode('DATA_PLANE_SHUTDOWN_FAILED'), 'terminal');
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

test('structured stop reasons remain useful when a fatal event is unavailable', () => {
  assert.match(classifyEngineStopReason('local_service_failed', 6180), /6180/);
  assert.match(classifyEngineStopReason('network_unhealthy', 6180), /网关通道/);
  assert.match(classifyEngineStopReason('event_output_failed', 6180), /状态通道/);
  assert.equal(classifyEngineStopReason('user_requested', 6180), null);
  assert.equal(classifyEngineStopReason('unknown_reason', 6180), null);
  assert.equal(engineFailureKindFromStopReason('local_service_failed'), 'terminal');
  assert.equal(engineFailureKindFromStopReason('logout_failed'), 'terminal');
  assert.equal(engineFailureKindFromStopReason('network_unhealthy'), 'gateway-transient');
  assert.equal(engineFailureKindFromStopReason('startup_failed'), 'unknown');
});

test('failure classification trusts code, then stop reason, before English diagnostics', () => {
  assert.equal(resolveEngineFailureKind({
    code: 'AUTH_FAILED',
    stopReason: 'network_unhealthy',
    diagnosticText: 'modern receive TLS: failed',
  }), 'terminal');
  assert.equal(resolveEngineFailureKind({
    stopReason: 'network_unhealthy',
    diagnosticText: 'gateway authentication failed',
  }), 'gateway-transient');
  assert.equal(resolveEngineFailureKind({
    stopReason: 'startup_failed',
    diagnosticText: 'gateway authentication failed',
  }), 'terminal');
});
