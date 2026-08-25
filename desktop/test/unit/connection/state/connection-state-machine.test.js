'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CONNECTION_PHASE,
  ConnectionStateMachine,
  connectionPresentation,
  projectConnectionStatus,
} = require('../../../../lib/connection/state/connection-state-machine');
const { STABLE_SESSION_MS } = require('../../../../lib/connection/state/reconnect-policy');

function start(machine, generation = 1) {
  const intent = machine.beginConnectIntent();
  assert.equal(machine.beginConnectAttempt(intent), true);
  assert.equal(machine.bindEngineGeneration(generation), true);
  return intent;
}

function markReady(machine, generation, order = 'listener-first') {
  if (machine.snapshot().phase !== CONNECTION_PHASE.PREPARING_TUNNEL &&
      machine.snapshot().phase !== CONNECTION_PHASE.CONNECTED) {
    assert.equal(machine.markEnginePhase(generation, 'preparing_tunnel'), true);
  }
  if (order === 'engine-first') {
    assert.equal(machine.recordEngineConnectedCandidate(generation), false);
    assert.equal(machine.recordListenerReady(generation), true);
  } else {
    assert.equal(machine.recordListenerReady(generation), false);
    assert.equal(machine.recordEngineConnectedCandidate(generation), true);
  }
  return machine.markConnected(generation);
}

test('starts disconnected with an immutable diagnostic snapshot', () => {
  const machine = new ConnectionStateMachine();
  const snapshot = machine.snapshot();
  assert.deepEqual(snapshot, {
    intent: 0,
    desiredConnected: false,
    userDisconnected: false,
    attempts: 0,
    attemptNumber: 1,
    phase: CONNECTION_PHASE.IDLE,
    engineGeneration: null,
    engineConnectedCandidate: false,
    listenerReady: false,
    wasConnectedBeforeStop: false,
    connectedUptimeBeforeStop: 0,
  });
  assert.equal(Object.isFrozen(snapshot), true);
});

test('presentation is a pure projection of the authoritative phase', () => {
  const machine = new ConnectionStateMachine();
  assert.deepEqual(connectionPresentation(machine.snapshot()), {
    phase: CONNECTION_PHASE.IDLE,
    connected: false,
    connecting: false,
  });
  const intent = machine.beginConnectIntent();
  assert.equal(machine.beginConnectAttempt(intent), true);
  assert.deepEqual(machine.presentation(), {
    phase: CONNECTION_PHASE.STARTING,
    connected: false,
    connecting: true,
  });
  assert.equal(machine.bindEngineGeneration(1), true);
  assert.equal(machine.markEnginePhase(1, 'authenticating'), true);
  assert.equal(machine.presentation().phase, CONNECTION_PHASE.AUTHENTICATING);
  assert.equal(machine.markEnginePhase(1, 'preparing_tunnel'), true);
  assert.equal(machine.presentation().phase, CONNECTION_PHASE.PREPARING_TUNNEL);
  assert.equal(markReady(machine, 1), true);
  assert.deepEqual(machine.presentation(), {
    phase: CONNECTION_PHASE.CONNECTED,
    connected: true,
    connecting: false,
  });
});

test('status projection keeps connection failures separate from local notices', () => {
  const projected = projectConnectionStatus({
    lastError: 'engine failed',
    settingsError: 'settings failed',
    recoveryError: 'recovery failed',
    notice: 'restored',
    browserNotice: 'browser paused',
    diagnosticNotice: 'log unavailable',
  }, { phase: 'idle', connected: false, connecting: false }, null);
  assert.equal(projected.lastError, 'engine failed\nsettings failed\nrecovery failed');
  assert.equal(projected.notice, 'restored\nbrowser paused\nlog unavailable');
  assert.equal(Object.isFrozen(projected), true);
});

test('engine phase order rejects regressions and stale generations', () => {
  const machine = new ConnectionStateMachine();
  start(machine, 9);
  assert.equal(machine.markEnginePhase(8, 'authenticating'), false);
  assert.equal(machine.markEnginePhase(9, 'unknown'), false);
  assert.equal(machine.markEnginePhase(9, 'authenticating'), true);
  assert.equal(machine.markEnginePhase(9, 'connecting'), false);
  assert.equal(machine.markEnginePhase(9, 'preparing_tunnel'), true);
  assert.equal(machine.markEnginePhase(9, 'authenticating'), false);
});

test('connected promotion requires same-generation Engine and listener evidence', () => {
  const listenerFirst = new ConnectionStateMachine();
  start(listenerFirst, 21);
  assert.equal(listenerFirst.recordListenerReady(21), false,
    'readiness cannot be recorded before tunnel preparation');
  assert.equal(listenerFirst.recordEngineConnectedCandidate(21), false);
  assert.equal(listenerFirst.markEnginePhase(21, 'preparing_tunnel'), true);
  assert.equal(listenerFirst.recordListenerReady(21), false);
  assert.equal(listenerFirst.markConnected(21), false);
  assert.equal(listenerFirst.recordEngineConnectedCandidate(20), false);
  assert.equal(listenerFirst.recordEngineConnectedCandidate(21), true);
  assert.equal(listenerFirst.markConnected(21), true);

  const engineFirst = new ConnectionStateMachine();
  start(engineFirst, 22);
  assert.equal(engineFirst.recordEngineConnectedCandidate(22), false);
  assert.equal(engineFirst.markConnected(22), false);
  assert.equal(engineFirst.markEnginePhase(22, 'preparing_tunnel'), true);
  assert.equal(engineFirst.recordEngineConnectedCandidate(22), false);
  assert.equal(engineFirst.recordListenerReady(22), true);
  assert.equal(engineFirst.markConnected(22), true);
  engineFirst.invalidateEngineGeneration();
  assert.equal(engineFirst.snapshot().engineConnectedCandidate, false);
  assert.equal(engineFirst.snapshot().listenerReady, false);
});

test('new connect intent supersedes stale continuations', () => {
  const machine = new ConnectionStateMachine();
  const first = machine.beginConnectIntent();
  const second = machine.beginConnectIntent();
  assert.equal(machine.canContinue(first), false);
  assert.equal(machine.beginConnectAttempt(first), false);
  assert.equal(machine.canContinue(second), true);
  assert.equal(machine.beginConnectAttempt(second), true);
});

test('normal attempts reset manual-disconnect state and retry budget', () => {
  const machine = new ConnectionStateMachine();
  const first = start(machine, 7);
  const retry = machine.engineClosed({
    generation: 7,
    maxAttempts: 3,
  });
  assert.deepEqual(retry, { action: 'retry', attempt: 1, delayMs: 2000 });
  assert.equal(machine.beginConnectAttempt(first, { isRetry: true }), true);
  assert.equal(machine.snapshot().attempts, 1);

  const reconnect = machine.beginStop(true);
  assert.equal(machine.snapshot().userDisconnected, true);
  assert.equal(machine.resumeAfterStop(reconnect), true);
  assert.equal(machine.beginConnectAttempt(reconnect), true);
  assert.equal(machine.snapshot().attempts, 0);
  assert.equal(machine.snapshot().userDisconnected, false);
});

test('explicit stop invalidates generation before asynchronous process close', () => {
  const machine = new ConnectionStateMachine();
  start(machine, 11);
  const stopIntent = machine.beginStop(false);
  assert.deepEqual(machine.snapshot(), {
    intent: stopIntent,
    desiredConnected: false,
    userDisconnected: true,
    attempts: 0,
    attemptNumber: 1,
    phase: CONNECTION_PHASE.STOPPING,
    engineGeneration: null,
    engineConnectedCandidate: false,
    listenerReady: false,
    wasConnectedBeforeStop: false,
    connectedUptimeBeforeStop: 0,
  });
  assert.deepEqual(machine.engineClosed({
    generation: 11,
    supervisorGenerationCurrent: false,
  }), { action: 'ignored' });
  assert.deepEqual(machine.stopCompleted(stopIntent, { ok: true }), {
    action: 'stopped',
    desiredConnected: false,
  });
  assert.equal(machine.snapshot().phase, CONNECTION_PHASE.IDLE);
});

test('reconnect stop preserves desire but requires explicit resume', () => {
  const machine = new ConnectionStateMachine();
  start(machine, 3);
  const intent = machine.beginStop(true);
  assert.equal(machine.canContinue(intent), true);
  assert.equal(machine.snapshot().userDisconnected, true);
  assert.equal(machine.canAttempt(intent), false);
  assert.equal(machine.markConnected(3), false);
  assert.equal(machine.resumeAfterStop(intent), true);
  assert.equal(machine.canAttempt(intent), true);
  assert.equal(machine.snapshot().userDisconnected, false);
  assert.equal(machine.snapshot().phase, CONNECTION_PHASE.STARTING);
});

test('stale stop completion cannot resume a superseded intent', () => {
  const machine = new ConnectionStateMachine();
  const stale = machine.beginStop(true);
  machine.beginStop(false);
  assert.deepEqual(machine.stopCompleted(stale, { ok: true }), { action: 'stale' });
  assert.equal(machine.resumeAfterStop(stale), false);
});

test('connectivity pause invalidates generation while retaining user intent', () => {
  const machine = new ConnectionStateMachine();
  const intent = start(machine, 5);
  assert.equal(machine.pauseForConnectivity(intent), true);
  assert.equal(machine.snapshot().desiredConnected, true);
  assert.equal(machine.snapshot().engineGeneration, null);
  assert.equal(machine.snapshot().phase, CONNECTION_PHASE.CONNECTIVITY_PAUSED);
  assert.equal(machine.resumeConnectivity(intent, { autoReconnect: false }), false);
  assert.equal(machine.resumeConnectivity(intent, { autoReconnect: true }), true);
  assert.equal(machine.snapshot().phase, CONNECTION_PHASE.STARTING);
});

test('quit, stale intent, and disabled reconnect reject connectivity recovery', () => {
  const machine = new ConnectionStateMachine();
  const intent = machine.beginConnectIntent();
  assert.equal(machine.currentRecoveryIntent(), intent);
  assert.equal(machine.currentRecoveryIntent({ isQuitting: true }), null);
  assert.equal(machine.canRecover(intent, { isQuitting: true }), false);
  assert.equal(machine.canRecover(intent, { autoReconnect: false }), false);
  assert.equal(machine.canRecover(intent + 1), false);
});

test('generation binding is bounded and connection events are generation scoped', () => {
  const machine = new ConnectionStateMachine();
  const intent = machine.beginConnectIntent();
  assert.equal(machine.beginConnectAttempt(intent), true);
  assert.equal(machine.bindEngineGeneration(0), false);
  assert.equal(machine.bindEngineGeneration(Number.MAX_SAFE_INTEGER + 1), false);
  assert.equal(machine.bindEngineGeneration(9), true);
  assert.equal(machine.markEnginePhase(8, 'authenticating'), false);
  assert.equal(machine.markEnginePhase(9, 'authenticating'), true);
  assert.equal(markReady(machine, 9), true);
  assert.equal(machine.snapshot().phase, CONNECTION_PHASE.CONNECTED);
  assert.equal(machine.canContinue(intent), true);
});

test('old generation close is a strict no-op after a newer engine is bound', () => {
  const machine = new ConnectionStateMachine();
  start(machine, 20);
  assert.equal(machine.bindEngineGeneration(21), true);
  const before = machine.snapshot();
  assert.deepEqual(machine.engineClosed({
    generation: 20,
    supervisorGenerationCurrent: false,
    terminalFailure: true,
  }), { action: 'ignored' });
  assert.deepEqual(machine.snapshot(), before);
});

test('process exit revokes serving promotion while preserving close retry context', () => {
  const machine = new ConnectionStateMachine();
  start(machine, 23);
  assert.equal(markReady(machine, 23), true);
  assert.equal(machine.markEngineStopping(22, { uptimeMs: 500 }), false);
  assert.equal(machine.markEngineStopping(23, { uptimeMs: STABLE_SESSION_MS + 1 }), true);
  assert.equal(machine.presentation().connected, false);
  assert.equal(machine.snapshot().phase, CONNECTION_PHASE.STOPPING);
  assert.equal(machine.snapshot().engineConnectedCandidate, false);
  assert.equal(machine.snapshot().listenerReady, false);
  assert.equal(machine.snapshot().wasConnectedBeforeStop, true);
  assert.equal(machine.snapshot().connectedUptimeBeforeStop, STABLE_SESSION_MS + 1);
  assert.equal(machine.recordListenerReady(23), false);
  assert.equal(machine.recordEngineConnectedCandidate(23), false);
  assert.equal(machine.markConnected(23), false);
  assert.deepEqual(machine.engineClosed({
    generation: 23,
    autoReconnect: true,
    maxAttempts: 3,
    uptimeMs: 0,
  }), { action: 'retry', attempt: 1, delayMs: 2000 });
});

test('terminal engine close disables desire and never retries', () => {
  const machine = new ConnectionStateMachine();
  start(machine, 4);
  assert.deepEqual(machine.engineClosed({
    generation: 4,
    terminalFailure: true,
    autoReconnect: true,
    maxAttempts: 10,
  }), { action: 'terminal', desiredConnected: false });
  assert.equal(machine.snapshot().phase, CONNECTION_PHASE.IDLE);
  assert.equal(machine.currentRecoveryIntent(), null);
});

test('user-disconnected close settles without consuming retry budget', () => {
  const machine = new ConnectionStateMachine();
  start(machine, 12);
  // Model the narrow supervisor/FSM hand-off state through public transitions:
  // the user stop wins, then an already-started child reports its generation.
  machine.beginStop(true);
  assert.equal(machine.bindEngineGeneration(12), true);
  assert.deepEqual(machine.engineClosed({
    generation: 12,
    maxAttempts: 3,
  }), { action: 'settled', desiredConnected: true });
  assert.equal(machine.snapshot().attempts, 0);
});

test('short-lived failures consume retry budget and use failure-specific delay', () => {
  const machine = new ConnectionStateMachine();
  start(machine, 30);
  assert.equal(markReady(machine, 30), true);
  assert.deepEqual(machine.engineClosed({
    generation: 30,
    autoReconnect: true,
    maxAttempts: 3,
    uptimeMs: 1000,
    failureKind: 'gateway-transient',
  }), { action: 'retry', attempt: 1, delayMs: 5000 });
  assert.equal(machine.snapshot().phase, CONNECTION_PHASE.RETRY_WAIT);
  assert.equal(machine.snapshot().attempts, 1);
});

test('stable connection earns a fresh retry budget', () => {
  const machine = new ConnectionStateMachine();
  const intent = start(machine, 40);
  for (const generation of [40, 41, 42]) {
    const order = generation % 2 ? 'engine-first' : 'listener-first';
    assert.equal(markReady(machine, generation, order), true);
    assert.equal(machine.engineClosed({
      generation,
      autoReconnect: true,
      maxAttempts: 3,
      uptimeMs: 1000,
    }).action, 'retry');
    assert.equal(machine.beginConnectAttempt(intent, { isRetry: true }), true);
    assert.equal(machine.bindEngineGeneration(generation + 1), true);
  }
  assert.equal(markReady(machine, 43, 'engine-first'), true);
  assert.deepEqual(machine.engineClosed({
    generation: 43,
    autoReconnect: true,
    maxAttempts: 3,
    uptimeMs: STABLE_SESSION_MS + 1,
  }), { action: 'retry', attempt: 1, delayMs: 2000 });
  assert.equal(machine.beginConnectAttempt(intent, { isRetry: true }), true);
});

test('disabled or exhausted reconnect clears desired state', () => {
  for (const autoReconnect of [false, true]) {
    const machine = new ConnectionStateMachine();
    const intent = start(machine, 50);
    if (autoReconnect) {
      for (const generation of [50, 51]) {
        assert.equal(machine.engineClosed({
          generation,
          autoReconnect: true,
          maxAttempts: 2,
        }).action, 'retry');
        assert.equal(machine.beginConnectAttempt(intent, { isRetry: true }), true);
        assert.equal(machine.bindEngineGeneration(generation + 1), true);
      }
    }
    assert.deepEqual(machine.engineClosed({
      generation: autoReconnect ? 52 : 50,
      autoReconnect,
      maxAttempts: autoReconnect ? 2 : 100,
    }), { action: 'exhausted' });
    assert.equal(machine.snapshot().desiredConnected, false);
    assert.equal(machine.snapshot().phase, CONNECTION_PHASE.IDLE);
  }
});

test('only the current intent can be failed', () => {
  const machine = new ConnectionStateMachine();
  const intent = machine.beginConnectIntent();
  assert.equal(machine.failIntent(intent + 1), false);
  assert.equal(machine.snapshot().desiredConnected, true);
  assert.equal(machine.failIntent(intent), true);
  assert.equal(machine.snapshot().desiredConnected, false);
});
