'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isChromiumImplicitBypassHost,
  isIsolatedNetworkHost,
  isUnsafeBrowserTargetUrl,
} = require('../lib/host-safety');

test('local, private, link-local, CGNAT, multicast, and IPv6 literals stay isolated', () => {
  for (const host of [
    'localhost', 'loopback.', 'localhost.localdomain', 'localhost6',
    'localhost6.localdomain6', 'api.localhost', 'printer.local', '0.0.0.0', '10.2.3.4',
    '100.64.1.2', '100.127.255.254', '127.0.0.1', '169.254.2.3', '172.16.0.1',
    '172.31.255.254', '192.168.1.1', '224.0.0.1', '255.255.255.255', '::1',
    'fd00::1', 'fe80::1',
  ]) assert.equal(isIsolatedNetworkHost(host), true, host);
  for (const host of [
    '103.189.154.10', '100.63.255.255', '100.128.0.1', '172.15.255.255',
    '172.32.0.1', 'outlook.office.com',
  ]) assert.equal(isIsolatedNetworkHost(host), false, host);
});

test('campus browser blocks every explicit Chromium PAC bypass spelling', () => {
  for (const host of [
    'localhost', 'loopback.', 'localhost.localdomain', 'localhost6',
    'localhost6.localdomain6', 'api.localhost', 'printer.local', '0.0.0.0', '127.0.0.1',
    '169.254.1.2', '[::1]', '[fe80::1]', '[::ffff:7f00:1]',
  ]) assert.equal(isChromiumImplicitBypassHost(host), true, host);
  for (const host of ['10.1.2.3', '192.168.1.2', '103.189.154.10', 'outlook.office.com']) {
    assert.equal(isChromiumImplicitBypassHost(host), false, host);
  }

  for (const url of [
    'http://127.1/admin',
    'https://2130706433/',
    'http://0x7f000001/',
    'https://[::1]/',
    'http://[fe80::1]/',
    'https://service.localhost/',
    'http://loopback./admin',
    'https://localhost.localdomain/admin',
    'ws://localhost6/socket',
    'wss://localhost6.localdomain6/socket',
    'ws://127.0.0.1:9000/socket',
    'wss://[::1]/socket',
  ]) assert.equal(isUnsafeBrowserTargetUrl(url), true, url);
  assert.equal(isUnsafeBrowserTargetUrl('https://10.1.2.3/'), false);
  assert.equal(isUnsafeBrowserTargetUrl('https://103.189.154.10:4433/'), false);
  assert.equal(isUnsafeBrowserTargetUrl('wss://103.189.154.10:4433/socket'), false);
  assert.equal(isUnsafeBrowserTargetUrl('not a url'), false);
});
