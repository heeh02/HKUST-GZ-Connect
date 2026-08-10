'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  EngineControlClient,
  EngineControlResponseParser,
  normalizeControlResponse,
} = require('../lib/engine-control-client');

class FakeWritable extends EventEmitter {
  constructor() {
    super();
    this.frames = [];
    this.failure = null;
  }

  write(frame, callback) {
    this.frames.push(JSON.parse(Buffer.from(frame).toString('utf8')));
    callback?.(this.failure);
    return true;
  }
}

test('control response parser ignores Event API v1 and accepts split v2 frames', () => {
  const parser = new EngineControlResponseParser();
  assert.deepEqual(parser.feed('{"type":"hello","apiVersion":1,"capabilities":[]}\n'), []);
  assert.deepEqual(parser.feed('{"type":"control_hello","apiVersion":2,'), []);
  assert.deepEqual(parser.feed('"requestId":1,"capabilities":["engine.shutdown"]}\n'), [{
    type: 'control_hello',
    apiVersion: 2,
    requestId: 1,
    capabilities: ['engine.shutdown'],
  }]);
});

test('malformed, unknown, duplicate capability and oversized responses stay bounded', () => {
  const parser = new EngineControlResponseParser({ maxFrameBytes: 96, maxBufferBytes: 128 });
  assert.deepEqual(parser.feed('not-json\n'), []);
  assert.deepEqual(parser.feed(`${'x'.repeat(160)}\n`), []);
  assert.deepEqual(parser.feed(
    '{"type":"control_result","apiVersion":2,"requestId":4,"status":"accepted"}\n',
  ), [{ type: 'control_result', apiVersion: 2, requestId: 4, status: 'accepted' }]);
  assert.deepEqual(normalizeControlResponse({
    type: 'control_hello', apiVersion: 2, requestId: 1, capabilities: ['a.b', 'a.b'],
  }).capabilities, ['a.b']);
});

test('client negotiates v2 then requests typed graceful shutdown', async () => {
  const writable = new FakeWritable();
  const client = new EngineControlClient({ writable });
  const hello = client.handshake();
  assert.deepEqual(writable.frames[0], { type: 'hello', requestId: 1, versions: [2] });
  client.feed('{"type":"control_hello","apiVersion":2,"requestId":1,"capabilities":["engine.shutdown"]}\n');
  assert.equal((await hello).capabilities[0], 'engine.shutdown');

  const shutdown = client.shutdown();
  assert.deepEqual(writable.frames[1], {
    type: 'request', apiVersion: 2, requestId: 2, command: { name: 'shutdown' },
  });
  client.feed('{"type":"control_result","apiVersion":2,"requestId":2,"status":"accepted"}\n');
  assert.equal((await shutdown).status, 'accepted');
});

test('typed errors and stream close reject pending requests without leaking payloads', async () => {
  const writable = new FakeWritable();
  const client = new EngineControlClient({ writable });
  const hello = client.handshake();
  client.feed('{"type":"control_error","apiVersion":2,"requestId":1,"error":{"code":"version_unsupported","supportedVersions":[2]}}\n');
  await assert.rejects(hello, (error) => error.code === 'version_unsupported');

  const closingClient = new EngineControlClient({ writable: new FakeWritable() });
  const second = closingClient.handshake();
  closingClient.close();
  await assert.rejects(second, /closed/);
});

test('write errors and request timeouts fail locally', async () => {
  const writable = new FakeWritable();
  writable.failure = new Error('private detail');
  const failedWrite = new EngineControlClient({ writable }).handshake();
  await assert.rejects(failedWrite, /^Error: cannot write engine control request$/);

  let timeoutCallback;
  const timeoutClient = new EngineControlClient({
    writable: new FakeWritable(),
    setTimeoutFn: (callback) => {
      timeoutCallback = callback;
      return { unref() {} };
    },
    clearTimeoutFn: () => {},
  });
  const timedOut = timeoutClient.handshake();
  timeoutCallback();
  await assert.rejects(timedOut, /timed out/);
});
