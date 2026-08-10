'use strict';

const net = require('node:net');

const MAX_HOST_BYTES = 253;
const MAX_AUTH_BYTES = 255;

function boundedAuthenticationValue(value) {
  const encoded = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
  if (!encoded.length || encoded.length > MAX_AUTH_BYTES) {
    throw new Error('invalid SOCKS authentication value');
  }
  return encoded;
}

function socksAuthenticationRequest(credentials) {
  const username = boundedAuthenticationValue(credentials?.username);
  const password = boundedAuthenticationValue(credentials?.password);
  return Buffer.concat([
    Buffer.from([1, username.length]),
    username,
    Buffer.from([password.length]),
    password,
  ]);
}

function socksConnectRequest(host, port) {
  const encoded = Buffer.from(String(host), 'ascii');
  const targetPort = Number(port);
  if (!encoded.length || encoded.length > MAX_HOST_BYTES ||
      !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    throw new Error('invalid SOCKS health target');
  }
  return Buffer.concat([
    Buffer.from([5, 1, 0, 3, encoded.length]),
    encoded,
    Buffer.from([targetPort >> 8, targetPort & 0xff]),
  ]);
}

function probeSocksConnect({
  proxyHost = '127.0.0.1',
  proxyPort,
  targetHost,
  targetPort = 443,
  timeoutMs = 5000,
  proxyCredentials = null,
}) {
  return new Promise((resolve) => {
    let settled = false;
    let stage = 'greeting';
    let buffered = Buffer.alloc(0);
    const socket = net.createConnection({
      host: proxyHost,
      port: Number(proxyPort),
    });
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    const authenticationRequired = proxyCredentials !== null;
    socket.once('connect', () => socket.write(Buffer.from([
      5, 1, authenticationRequired ? 2 : 0,
    ])));
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (stage === 'greeting' && buffered.length >= 2) {
        const expectedMethod = authenticationRequired ? 2 : 0;
        if (buffered[0] !== 5 || buffered[1] !== expectedMethod) return finish(false);
        buffered = buffered.subarray(2);
        if (authenticationRequired) {
          stage = 'authentication';
          let request;
          try { request = socksAuthenticationRequest(proxyCredentials); }
          catch { return finish(false); }
          socket.write(request);
        } else {
          stage = 'connect';
          socket.write(socksConnectRequest(targetHost, targetPort));
        }
      }
      if (stage === 'authentication' && buffered.length >= 2) {
        if (buffered[0] !== 1 || buffered[1] !== 0) return finish(false);
        buffered = buffered.subarray(2);
        stage = 'connect';
        socket.write(socksConnectRequest(targetHost, targetPort));
      }
      if (stage === 'connect' && buffered.length >= 2) {
        finish(buffered[0] === 5 && buffered[1] === 0);
      }
    });
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

module.exports = {
  probeSocksConnect,
  socksAuthenticationRequest,
  socksConnectRequest,
};
