'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadSettings, normalizeSettings, saveSettings } = require('../lib/settings-store');
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

test('port 6180 is written atomically and survives a reload', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');

  saveSettings(file, { port: 1080 });
  const saved = saveSettings(file, { port: '6180' });

  assert.equal(saved.port, 6180);
  assert.equal(loadSettings(file).port, 6180);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).port, 6180);
  assert.deepEqual(
    fs.readdirSync(directory).filter((entry) => entry.endsWith('.tmp')),
    [],
  );
});

test('credential storage rejects Linux plaintext backend', () => {
  const plaintext = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'basic_text',
  };
  assert.equal(protectedStorageAvailable(plaintext, 'linux'), false);
  assert.equal(protectedStorageAvailable(plaintext, 'darwin'), true);
});
