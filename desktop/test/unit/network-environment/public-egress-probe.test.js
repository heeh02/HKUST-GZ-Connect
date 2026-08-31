'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  PublicEgressProbe,
  createHttpsPublicEgressRequester,
  isPublicEgressAddress,
  parseObservedPublicIp,
} = require('../../../lib/network-environment/egress/public-egress-probe');

function fakeHttps({ statusCode = 200, body = '{"ip":"8.8.8.8"}',
  socketAddress = '192.0.2.10', neverRespond = false } = {}) {
  const capture = { agentOptions: null, requestOptions: null, responseDestroyed: false,
    agentDestroyed: false };
  class Agent {
    constructor(options) { capture.agentOptions = options; }
    destroy() { capture.agentDestroyed = true; }
  }
  return { capture, module: { Agent, request(options, onResponse) {
    capture.requestOptions = options;
    const request = new EventEmitter();
    request.destroy = (error) => queueMicrotask(() => request.emit('error', error));
    request.end = () => {
      if (neverRespond) return;
      const socket = new EventEmitter(); socket.localAddress = socketAddress;
      request.emit('socket', socket); socket.emit('connect');
      const response = new EventEmitter();
      response.statusCode = statusCode;
      response.setEncoding = () => {};
      response.resume = () => {};
      response.destroy = () => { capture.responseDestroyed = true; };
      onResponse(response);
      if (statusCode === 200) {
        response.emit('data', body);
        response.emit('end');
      }
    };
    return request;
  } } };
}

test('public egress parser accepts only bounded global IP responses', () => {
  assert.equal(parseObservedPublicIp('{"ip":"8.8.8.8"}'), '8.8.8.8');
  assert.equal(parseObservedPublicIp('2606:4700:4700::1111\n'), '2606:4700:4700::1111');
  for (const value of [
    '{"ip":"10.0.0.1"}', '{"ip":"100.64.0.1"}', '{"ip":"192.168.1.2"}',
    '{"ip":"203.0.113.2"}', '<html>not an ip</html>', '{"ip":"8.8.8.8","extra":true}',
  ]) assert.equal(parseObservedPublicIp(value), '');
  assert.equal(isPublicEgressAddress('1.1.1.1'), true);
  assert.equal(isPublicEgressAddress('fd00::1'), false);
});

test('HTTPS requester is fixed, source-bound, proxy-env-free, and lifecycle bounded', async () => {
  let fake = fakeHttps();
  let requester = createHttpsPublicEgressRequester({ httpsModule: fake.module, timeoutMs: 50 });
  assert.equal((await requester({ sourceAddress: '192.0.2.10', family: 4 })).address, '8.8.8.8');
  assert.equal(fake.capture.requestOptions.localAddress, '192.0.2.10');
  assert.equal(fake.capture.requestOptions.family, 4);
  assert.equal(fake.capture.requestOptions.hostname, 'api64.ipify.org');
  assert.deepEqual(fake.capture.agentOptions.proxyEnv, {});
  assert.equal(fake.capture.agentOptions.keepAlive, false);
  requester.dispose();
  assert.equal(fake.capture.agentDestroyed, true);

  fake = fakeHttps({ statusCode: 503 });
  requester = createHttpsPublicEgressRequester({ httpsModule: fake.module, timeoutMs: 50 });
  await assert.rejects(requester({ sourceAddress: '192.0.2.10', family: 4 }), {
    code: 'PUBLIC_EGRESS_HTTP_STATUS',
  });
  assert.equal(fake.capture.responseDestroyed, true);

  fake = fakeHttps({ socketAddress: '192.0.2.99' });
  requester = createHttpsPublicEgressRequester({ httpsModule: fake.module, timeoutMs: 50 });
  await assert.rejects(requester({ sourceAddress: '192.0.2.10', family: 4 }), {
    code: 'PUBLIC_EGRESS_SOURCE_NOT_BOUND',
  });

  fake = fakeHttps({ neverRespond: true });
  requester = createHttpsPublicEgressRequester({ httpsModule: fake.module, timeoutMs: 20 });
  await assert.rejects(requester({ sourceAddress: '192.0.2.10', family: 4 }), {
    code: 'PUBLIC_EGRESS_TIMEOUT',
  });
});

test('public egress requests are source-bound jobs with bounded concurrency', async () => {
  let active = 0;
  let peak = 0;
  const releases = [];
  const probe = new PublicEgressProbe({ concurrency: 2, requestIp: (request) => {
    active += 1;
    peak = Math.max(peak, active);
    return new Promise((resolve) => releases.push(() => {
      active -= 1;
      resolve({ address: '8.8.8.8', family: 4, binding: 'source-address', provider: 'ipify' });
    }));
  } });
  const pending = ['192.0.2.1', '192.0.2.2', '192.0.2.3'].map((sourceAddress) => (
    probe.probe({ sourceAddress, family: 4 })
  ));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 2);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 2, 'the queued third probe starts only after one slot is released');
  releases.shift()();
  releases.shift()();
  assert.equal((await Promise.all(pending)).length, 3);
  assert.equal(peak, 2);
});

test('cancelling a network generation rejects queued and active jobs and dispose closes the requester', async () => {
  let disposed = false;
  let requestCalls = 0;
  const requestIp = ({ signal }) => new Promise((_resolve, reject) => {
    requestCalls += 1;
    signal.addEventListener('abort', () => {
      const error = new Error('cancelled'); error.code = 'PUBLIC_EGRESS_CANCELLED'; reject(error);
    }, { once: true });
  });
  requestIp.dispose = () => { disposed = true; };
  const probe = new PublicEgressProbe({ requestIp, concurrency: 1 });
  const active = probe.probe({ sourceAddress: '192.0.2.10', family: 4 });
  const queued = probe.probe({ sourceAddress: '192.0.2.11', family: 4 });
  probe.cancel();
  await assert.rejects(active, { code: 'PUBLIC_EGRESS_CANCELLED' });
  await assert.rejects(queued, { code: 'PUBLIC_EGRESS_CANCELLED' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestCalls, 0, 'same-tick cancellation never creates a socket request');
  assert.equal(probe.active, 0);
  probe.dispose();
  assert.equal(disposed, true);
  await assert.rejects(probe.probe({ sourceAddress: '192.0.2.12', family: 4 }), {
    code: 'PUBLIC_EGRESS_CANCELLED',
  });
});
