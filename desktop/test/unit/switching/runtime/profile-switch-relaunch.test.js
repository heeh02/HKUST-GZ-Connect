'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  PROFILE_SWITCH_RELAUNCH_PREFIX,
  profileSwitchRelaunchArguments,
  relaunchAfterProfileSwitch,
  scheduleProfileSwitchRelaunch,
  writeProfileSwitchE2EMarker,
} = require('../../../../lib/switching/runtime/profile-switch-relaunch');

const first = `switch-${'a'.repeat(32)}`;
const second = `switch-${'b'.repeat(32)}`;

test('packaged and development relaunches carry one exact switch identity', () => {
  assert.deepEqual(profileSwitchRelaunchArguments({
    argv: ['/Applications/Campus Connect.app/Contents/MacOS/Campus Connect', '--example'],
    isPackaged: true,
    developmentEntry: '/unused',
    switchId: first,
  }), ['--example', `${PROFILE_SWITCH_RELAUNCH_PREFIX}${first}`]);
  assert.deepEqual(profileSwitchRelaunchArguments({
    argv: ['/Electron', '/repo/desktop/e2e/wrapper.js'],
    isPackaged: false,
    developmentEntry: '/repo/desktop',
    switchId: first,
  }), ['/repo/desktop', `${PROFILE_SWITCH_RELAUNCH_PREFIX}${first}`]);
});

test('same switch relaunch is blocked while a later user switch replaces the old marker', () => {
  const oldMarker = `${PROFILE_SWITCH_RELAUNCH_PREFIX}${first}`;
  assert.throws(() => profileSwitchRelaunchArguments({
    argv: ['/app', oldMarker],
    isPackaged: true,
    developmentEntry: '/unused',
    switchId: first,
  }), (error) => error?.code === 'PROFILE_SWITCH_RELAUNCH_LOOP_BLOCKED');
  assert.deepEqual(profileSwitchRelaunchArguments({
    argv: ['/app', oldMarker, '--kept'],
    isPackaged: true,
    developmentEntry: '/unused',
    switchId: second,
  }), ['--kept', `${PROFILE_SWITCH_RELAUNCH_PREFIX}${second}`]);
});

test('relaunch owner schedules one successor and exits only after argument validation', () => {
  const calls = [];
  relaunchAfterProfileSwitch({
    application: {
      relaunch: (options) => calls.push(['relaunch', options]),
      exit: (code) => calls.push(['exit', code]),
    },
    argv: ['/app'],
    isPackaged: true,
    developmentEntry: '/unused',
    switchId: first,
  });
  assert.deepEqual(calls, [
    ['relaunch', { args: [`${PROFILE_SWITCH_RELAUNCH_PREFIX}${first}`] }],
    ['exit', 0],
  ]);
});

test('malformed switch identities never become process arguments', () => {
  for (const switchId of ['', 'switch-short', `switch-${'G'.repeat(32)}`, '../switch']) {
    assert.throws(() => profileSwitchRelaunchArguments({
      argv: ['/app'], isPackaged: true, developmentEntry: '/unused', switchId,
    }), /identity/u);
  }
});

test('live relaunch schedules successor before delayed cleanup and exit', async () => {
  const calls = [];
  let timer;
  scheduleProfileSwitchRelaunch({
    application: {
      relaunch: (options) => calls.push(['relaunch', options]),
      exit: (code) => calls.push(['exit', code]),
    },
    argv: ['/app'], isPackaged: true, developmentEntry: '/unused', switchId: first,
    beforeExit: async () => calls.push(['cleanup']),
    setTimeoutFn: (callback, delay) => { timer = callback; calls.push(['timer', delay]); return 7; },
  });
  assert.deepEqual(calls, [
    ['relaunch', { args: [`${PROFILE_SWITCH_RELAUNCH_PREFIX}${first}`] }],
    ['timer', 150],
  ]);
  timer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.slice(-2), [['cleanup'], ['exit', 0]]);
});

test('E2E marker is development-only bounded and key-free', (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-marker-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  assert.equal(writeProfileSwitchE2EMarker({
    application: { isPackaged: false },
    environment: { HKUSTGZ_PROFILE_SWITCH_E2E: '1' },
    userData,
    profileId: 'hkustgz',
    activeContextEpoch: 7,
  }), true);
  const marker = JSON.parse(fs.readFileSync(path.join(
    userData, 'profile-switch-e2e-ready.json'), 'utf8'));
  assert.deepEqual(Object.keys(marker).sort(), ['activeContextEpoch', 'pid', 'profileId']);
  assert.equal(marker.profileId, 'hkustgz');
  assert.equal(Object.hasOwn(marker, 'profileKey'), false);
  assert.equal(writeProfileSwitchE2EMarker({
    application: { isPackaged: true }, environment: { HKUSTGZ_PROFILE_SWITCH_E2E: '1' },
    userData, profileId: 'hkustgz', activeContextEpoch: 7,
  }), false);
});
