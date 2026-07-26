'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');
const { probeSocksConnect, socksConnectRequest } = require('../lib/socks-health');

test('SOCKS health request is a bounded domain CONNECT', () => {
  const request = socksConnectRequest('www.hkust-gz.edu.cn', 443);
  assert.deepEqual([...request.subarray(0, 5)], [5, 1, 0, 3, 19]);
  assert.equal(request.subarray(-2).readUInt16BE(), 443);
  assert.throws(() => socksConnectRequest('x'.repeat(254), 443), /invalid/);
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
