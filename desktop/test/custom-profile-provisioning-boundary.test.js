'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
}

test('custom Profile provisioning is credential Engine Browser and Renderer neutral', () => {
  const files = [
    'custom-profile-provisioning-plan.js',
    'custom-profile-provisioning-journal.js',
    'custom-profile-provisioning-store.js',
    'custom-profile-materializer.js',
    'custom-profile-index.js',
    'custom-profile-provisioning-runtime.js',
  ];
  const combined = files.map(source).join('\n');
  for (const forbidden of [
    "require('electron')",
    'safeStorage',
    'vpn-credential-envelope',
    'EngineSupervisor',
    'CampusBrowser',
    'ipcMain',
    'renderer/',
  ]) assert.equal(combined.includes(forbidden), false, forbidden);
  assert.equal(combined.includes('activeCredentialVersion: null'), true);
  assert.equal(combined.includes('autoConnect: false'), true);
});

test('production Main cannot activate unfinished custom provisioning yet', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.equal(main.includes("require('./lib/custom-profile-provisioning-runtime')"), false);
  assert.equal(main.includes("require('./lib/custom-profile-index')"), false);
});
