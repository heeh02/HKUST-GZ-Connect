'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');
const {
  probeSocksConnect,
  socksAuthenticationRequest,
  socksConnectRequest,
} = require('../lib/socks-health');

test('SOCKS health request is a bounded domain CONNECT', () => {
  const request = socksConnectRequest('www.hkust-gz.edu.cn', 443);
  assert.deepEqual([...request.subarray(0, 5)], [5, 1, 0, 3, 19]);
  assert.equal(request.subarray(-2).readUInt16BE(), 443);
  assert.throws(() => socksConnectRequest('x'.repeat(254), 443), /invalid/);
});

test('SOCKS authentication request is length-prefixed and bounded', () => {
  assert.deepEqual(
    socksAuthenticationRequest({ username: 'probe-user', password: 'probe-pass' }),
    Buffer.from([1, 10, ...Buffer.from('probe-user'), 10, ...Buffer.from('probe-pass')]),
  );
  assert.throws(() => socksAuthenticationRequest({ username: '', password: 'p' }), /invalid/);
  assert.throws(() => socksAuthenticationRequest({
    username: 'u', password: Buffer.alloc(256),
  }), /invalid/);
});

test('SOCKS health probe requires a successful proxy CONNECT reply', async () => {
  const server = net.createServer((socket) => {
    let stage = 0;
    socket.on('data', () => {
      if (stage++ === 0) socket.write(Buffer.from([5, 0]));
      else socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    assert.equal(await probeSocksConnect({
      proxyPort: address.port,
      targetHost: 'www.hkust-gz.edu.cn',
      timeoutMs: 1000,
    }), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('strict SOCKS health probe authenticates before CONNECT', async () => {
  const seen = [];
  const server = net.createServer((socket) => {
    let stage = 0;
    socket.on('data', (data) => {
      seen.push(Buffer.from(data));
      if (stage++ === 0) socket.write(Buffer.from([5, 2]));
      else if (stage === 2) socket.write(Buffer.from([1, 0]));
      else socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    assert.equal(await probeSocksConnect({
      proxyPort: address.port,
      targetHost: 'www.hkust-gz.edu.cn',
      proxyCredentials: { username: 'probe-user', password: 'probe-pass' },
      timeoutMs: 1000,
    }), true);
    assert.deepEqual(seen[0], Buffer.from([5, 1, 2]));
    assert.deepEqual(seen[1], socksAuthenticationRequest({
      username: 'probe-user', password: 'probe-pass',
    }));
    assert.deepEqual(seen[2], socksConnectRequest('www.hkust-gz.edu.cn', 443));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('strict SOCKS health probe fails closed on rejected authentication', async () => {
  const server = net.createServer((socket) => {
    let stage = 0;
    socket.on('data', () => {
      if (stage++ === 0) socket.write(Buffer.from([5, 2]));
      else socket.write(Buffer.from([1, 1]));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    assert.equal(await probeSocksConnect({
      proxyPort: address.port,
      targetHost: 'www.hkust-gz.edu.cn',
      proxyCredentials: { username: 'probe-user', password: 'wrong' },
      timeoutMs: 1000,
    }), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
