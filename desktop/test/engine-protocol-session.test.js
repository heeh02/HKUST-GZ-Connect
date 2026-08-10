'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ENGINE_HELLO_TIMEOUT_MS,
  EngineProtocolSession,
} = require('../lib/engine-protocol-session');

test('machine events are accepted only after one API hello', () => {
  const session = new EngineProtocolSession(7);
  assert.equal(session.accept({ type: 'listener_ready', port: 6180 }), false);
  assert.equal(session.helloSeen, false);
  assert.equal(session.accept({ type: 'hello', apiVersion: 1, capabilities: [] }), true);
  assert.equal(session.helloSeen, true);
  assert.equal(session.accept({ type: 'hello', apiVersion: 1, capabilities: [] }), false);
  assert.equal(session.accept({ type: 'listener_ready', port: 6180 }), true);
  assert.equal(ENGINE_HELLO_TIMEOUT_MS, 1500);
});

test('stopped reason is generation-bound and seals the protocol session', () => {
  const session = new EngineProtocolSession(12);
  session.accept({ type: 'hello', apiVersion: 1, capabilities: [] });
  assert.equal(session.accept({
    type: 'state_changed', state: 'connected', generation: 11,
  }), false);
  assert.equal(session.accept({
    type: 'stopped', reason: 'network_unhealthy', generation: 11,
  }), false);
  assert.equal(session.stoppedReason, null);

  assert.equal(session.accept({
    type: 'stopped', reason: 'network_unhealthy', generation: 12,
  }), true);
  assert.equal(session.stoppedReason, 'network_unhealthy');
  assert.equal(session.accept({ type: 'dns_mode', mode: 'gateway' }), false);
});

test('invalid generations cannot create protocol sessions', () => {
  for (const generation of [null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new EngineProtocolSession(generation), /generation/);
  }
});
