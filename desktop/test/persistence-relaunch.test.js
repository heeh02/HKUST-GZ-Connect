'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PERSISTENCE_RELAUNCH_ARGUMENT,
  persistenceRelaunchArguments,
  relaunchAfterPersistenceMigration,
  writePersistenceE2EMarker,
} = require('../lib/persistence-relaunch');

test('development migration relaunches the Desktop entry instead of its Electron test wrapper', () => {
  assert.deepEqual(persistenceRelaunchArguments({
    argv: ['/Electron', '/repo/desktop/e2e/main-network-startup.electron.js'],
    isPackaged: false,
    developmentEntry: '/repo/desktop',
  }), ['/repo/desktop', PERSISTENCE_RELAUNCH_ARGUMENT]);
});

test('packaged migration preserves launch arguments and adds one bounded marker', () => {
  assert.deepEqual(persistenceRelaunchArguments({
    argv: ['/Applications/Campus Connect.app/Contents/MacOS/Campus Connect', '--example'],
    isPackaged: true,
    developmentEntry: '/unused',
  }), ['--example', PERSISTENCE_RELAUNCH_ARGUMENT]);
});

test('a second migration request in the same relaunch chain fails closed', () => {
  assert.throws(() => persistenceRelaunchArguments({
    argv: ['/Electron', '/repo/desktop', PERSISTENCE_RELAUNCH_ARGUMENT],
    isPackaged: false,
    developmentEntry: '/repo/desktop',
  }), (error) => error?.code === 'PERSISTENCE_RELAUNCH_LOOP_BLOCKED');
});

test('relaunch owner schedules exactly one successor then exits current process', () => {
  const calls = [];
  relaunchAfterPersistenceMigration({
    application: {
      relaunch: (options) => calls.push(['relaunch', options]),
      exit: (code) => calls.push(['exit', code]),
    },
    argv: ['/Electron', '/wrapper.js'],
    isPackaged: false,
    developmentEntry: '/repo/desktop',
  });
  assert.deepEqual(calls, [
    ['relaunch', { args: ['/repo/desktop', PERSISTENCE_RELAUNCH_ARGUMENT] }],
    ['exit', 0],
  ]);
});

test('migration marker is unavailable to packaged builds and opt-in for Electron E2E', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'persistence-marker-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  assert.equal(writePersistenceE2EMarker({
    application: { isPackaged: false },
    environment: { HKUSTGZ_PERSISTENCE_E2E: '1' },
    userData,
    mode: 'profile-workspace',
  }), true);
  const marker = JSON.parse(fs.readFileSync(
    path.join(userData, 'persistence-e2e-ready.json'), 'utf8'));
  assert.equal(marker.mode, 'profile-workspace');
  assert.equal(marker.pid, process.pid);
});
