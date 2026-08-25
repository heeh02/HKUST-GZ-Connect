'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const desktopRoot = path.resolve(__dirname, '..', '..');

function source(file) {
  return fs.readFileSync(path.join(desktopRoot, 'lib', file), 'utf8');
}

test('custom Profile provisioning is credential Engine Browser and Renderer neutral', () => {
  const files = [
    'profiles/provisioning/custom-profile-provisioning-plan.js',
    'profiles/provisioning/custom-profile-provisioning-journal.js',
    'profiles/provisioning/custom-profile-provisioning-store.js',
    'profiles/provisioning/custom-profile-materializer.js',
    'profiles/registry/custom-profile-index.js',
    'profiles/provisioning/custom-profile-provisioning-runtime.js',
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

test('production Main activates provisioning through composition instead of low-level stores', () => {
  const main = fs.readFileSync(path.join(desktopRoot, 'main.js'), 'utf8');
  assert.equal(main.includes(
    "require('./lib/profiles/provisioning/custom-profile-provisioning-runtime')",
  ), false);
  assert.equal(main.includes("require('./lib/profiles/registry/custom-profile-index')"), false);
});
