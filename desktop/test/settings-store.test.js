'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeSettings } = require('../lib/settings-store');
const { protectedStorageAvailable } = require('../lib/credential-store');

test('settings normalization drops obsolete keys and bounds values', () => {
  assert.deepEqual(
    normalizeSettings({
      username: 'test-user',
      port: '2080',
      maxAttempts: 99,
      autoReconnect: false,
      startAtLogin: true,
      autoConnect: false,
      closeAction: 'minimize',
      server: 'untrusted.example',
      customDns: '1.2.3.4',
    }),
    {
      username: 'test-user',
      port: 2080,
      maxAttempts: 10,
      autoReconnect: false,
      startAtLogin: true,
      autoConnect: false,
      closeAction: 'minimize',
      routeDomains: ['hkust-gz.edu.cn', 'hkust.edu.hk'],
    },
  );
});

test('invalid ports and retry counts use reviewed defaults', () => {
  const settings = normalizeSettings({ port: 80, maxAttempts: 1.5 });
  assert.equal(settings.port, 1080);
  assert.equal(settings.maxAttempts, 3);
});

test('credential storage rejects Linux plaintext backend', () => {
  const plaintext = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'basic_text',
  };
  assert.equal(protectedStorageAvailable(plaintext, 'linux'), false);
  assert.equal(protectedStorageAvailable(plaintext, 'darwin'), true);
});
