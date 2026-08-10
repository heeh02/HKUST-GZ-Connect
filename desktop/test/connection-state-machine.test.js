'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CONNECTION_PHASE,
  ConnectionStateMachine,
} = require('../lib/connection-state-machine');
const { STABLE_SESSION_MS } = require('../lib/reconnect-policy');

function start(machine, generation = 1) {
  const intent = machine.beginConnectIntent();
  assert.equal(machine.beginConnectAttempt(intent), true);
  assert.equal(machine.bindEngineGeneration(generation), true);
  return intent;
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
  });
  assert.equal(Object.isFrozen(snapshot), true);
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
  assert.equal(machine.snapshot().phase, CONNECTION_PHASE.CONNECTING);
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
  assert.equal(machine.snapshot().phase, CONNECTION_PHASE.CONNECTING);
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
  assert.equal(machine.bindEngineGeneration(0), false);
  assert.equal(machine.bindEngineGeneration(Number.MAX_SAFE_INTEGER + 1), false);
  assert.equal(machine.bindEngineGeneration(9), true);
  assert.equal(machine.markConnecting(8), false);
  assert.equal(machine.markConnecting(9), true);
  assert.equal(machine.markConnected(9), true);
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
  assert.deepEqual(machine.engineClosed({
    generation: 30,
    autoReconnect: true,
    maxAttempts: 3,
    wasConnected: true,
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
    assert.equal(machine.engineClosed({
      generation,
      autoReconnect: true,
      maxAttempts: 3,
      wasConnected: true,
      uptimeMs: 1000,
    }).action, 'retry');
    assert.equal(machine.beginConnectAttempt(intent, { isRetry: true }), true);
    assert.equal(machine.bindEngineGeneration(generation + 1), true);
  }
  assert.deepEqual(machine.engineClosed({
    generation: 43,
    autoReconnect: true,
    maxAttempts: 3,
    wasConnected: true,
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

test('wait termination mirrors manual stop and terminal idle errors', () => {
  const machine = new ConnectionStateMachine();
  assert.equal(machine.shouldStopWaiting({ connecting: true, lastError: 'pending' }), false);
  assert.equal(machine.shouldStopWaiting({ connecting: false, hasActive: true, lastError: 'x' }), false);
  assert.equal(machine.shouldStopWaiting({ connecting: false, hasActive: false, lastError: 'x' }), true);
  machine.beginStop(false);
  assert.equal(machine.shouldStopWaiting({ connecting: true, hasActive: true }), true);
});
