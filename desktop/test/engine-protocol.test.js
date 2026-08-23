'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EngineEventParser,
  normalizeEngineEvent,
} = require('../lib/engine-protocol');

test('normalizes only bounded API v1 machine events and drops extra data', () => {
  assert.deepEqual(normalizeEngineEvent({
    type: 'hello', apiVersion: 1, capabilities: ['password', 'l3', 'udp'], secret: 'no',
  }), {
    type: 'hello', apiVersion: 1, capabilities: ['password', 'l3', 'udp'],
  });
  assert.deepEqual(normalizeEngineEvent({
    type: 'fatal_error', code: 'AUTH_FAILED', response: 'private gateway response',
  }), { type: 'fatal_error', code: 'AUTH_FAILED', secondaryCode: null });
  assert.deepEqual(normalizeEngineEvent({
    type: 'fatal_error',
    code: 'AUTH_INDETERMINATE',
    secondaryCode: 'AUTH_CLEANUP_UNCONFIRMED',
  }), {
    type: 'fatal_error',
    code: 'AUTH_INDETERMINATE',
    secondaryCode: 'AUTH_CLEANUP_UNCONFIRMED',
  });
  assert.equal(normalizeEngineEvent({
    type: 'fatal_error', code: 'AUTH_REJECTED', secondaryCode: 'PRIVATE_DETAIL',
  }), null);
  assert.equal(normalizeEngineEvent({ type: 'hello', apiVersion: 2, capabilities: [] }), null);
  assert.equal(normalizeEngineEvent({ type: 'listener_ready', port: 80 }), null);
  assert.equal(normalizeEngineEvent({ type: 'fatal_error', code: 'bad code' }), null);
  assert.equal(normalizeEngineEvent({ type: 'unknown', token: 'secret' }), null);
  assert.deepEqual(normalizeEngineEvent({ type: 'dns_mode', mode: 'vpn_profile' }), {
    type: 'dns_mode', mode: 'vpn_profile',
  });
  assert.deepEqual(normalizeEngineEvent({ type: 'dns_mode', mode: 'gateway_profile' }), {
    type: 'dns_mode', mode: 'gateway_profile',
  });
  assert.equal(normalizeEngineEvent({ type: 'dns_mode', mode: 'public_dns' }), null);
  assert.deepEqual(normalizeEngineEvent({
    type: 'state_changed', state: 'preparing_tunnel', generation: 9,
  }), { type: 'state_changed', state: 'preparing_tunnel', generation: 9 });
});

test('parses fragmented and coalesced NDJSON without interpreting diagnostic text', () => {
  const parser = new EngineEventParser();
  assert.deepEqual(parser.feed('{"type":"hello","apiVersion":1,'), []);
  assert.deepEqual(parser.feed('"capabilities":["password"]}\nnot json\n'
    + '{"type":"listener_ready","port":6180}\n'), [
    { type: 'hello', apiVersion: 1, capabilities: ['password'] },
    { type: 'listener_ready', port: 6180 },
  ]);
});

test('oversized or unterminated input is discarded and recovery starts at a line boundary', () => {
  const parser = new EngineEventParser({ maxEventBytes: 64, maxBufferBytes: 96 });
  assert.deepEqual(parser.feed('x'.repeat(120)), []);
  assert.deepEqual(parser.feed('\n{"type":"dns_mode","mode":"gateway"}\n'), [
    { type: 'dns_mode', mode: 'gateway' },
  ]);
  assert.deepEqual(parser.feed(`${JSON.stringify({
    type: 'fatal_error', code: 'A'.repeat(80),
  })}\n{"type":"network_unhealthy","reason":"receive_channel_closed"}\n`), [
    { type: 'network_unhealthy', reason: 'receive_channel_closed' },
  ]);
});

test('event schema never forwards IP addresses or human error messages', () => {
  assert.deepEqual(normalizeEngineEvent({
    type: 'client_ip_assigned', family: 4, address: '10.20.30.40',
  }), { type: 'client_ip_assigned', family: 4 });
  assert.deepEqual(normalizeEngineEvent({
    type: 'network_unhealthy', reason: 'receive_channel_closed', message: 'token=private',
  }), { type: 'network_unhealthy', reason: 'receive_channel_closed' });
});
