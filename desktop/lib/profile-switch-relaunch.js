'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROFILE_SWITCH_RELAUNCH_PREFIX = '--profile-switch-relaunch=';

function switchMarker(switchId) {
  if (typeof switchId !== 'string' || !/^switch-[a-f0-9]{32}$/u.test(switchId)) {
    throw new TypeError('Profile switch relaunch identity is invalid');
  }
  return `${PROFILE_SWITCH_RELAUNCH_PREFIX}${switchId}`;
}

function profileSwitchRelaunchArguments({
  argv,
  isPackaged,
  developmentEntry,
  switchId,
} = {}) {
  if (!Array.isArray(argv) || typeof isPackaged !== 'boolean' ||
      typeof developmentEntry !== 'string' || !developmentEntry) {
    throw new TypeError('Profile switch relaunch arguments are invalid');
  }
  const marker = switchMarker(switchId);
  if (argv.includes(marker)) {
    const error = new Error('Profile switch relaunch did not converge');
    error.code = 'PROFILE_SWITCH_RELAUNCH_LOOP_BLOCKED';
    throw error;
  }
  const base = isPackaged ? argv.slice(1) : [developmentEntry];
  return Object.freeze([
    ...base.filter((argument) => !String(argument).startsWith(PROFILE_SWITCH_RELAUNCH_PREFIX)),
    marker,
  ]);
}

function relaunchAfterProfileSwitch({
  application,
  argv,
  isPackaged,
  developmentEntry,
  switchId,
} = {}) {
  if (!application || typeof application.relaunch !== 'function' ||
      typeof application.exit !== 'function') {
    throw new TypeError('Profile switch relaunch application is invalid');
  }
  const args = profileSwitchRelaunchArguments({
    argv,
    isPackaged,
    developmentEntry,
    switchId,
  });
  application.relaunch({ args });
  application.exit(0);
}

function scheduleProfileSwitchRelaunch({
  application,
  argv,
  isPackaged,
  developmentEntry,
  switchId,
  beforeExit = async () => {},
  delayMs = 150,
  setTimeoutFn = setTimeout,
} = {}) {
  if (!application || typeof application.relaunch !== 'function' ||
      typeof application.exit !== 'function' || typeof beforeExit !== 'function' ||
      typeof setTimeoutFn !== 'function' || !Number.isSafeInteger(delayMs) ||
      delayMs < 0 || delayMs > 5_000) {
    throw new TypeError('scheduled Profile switch relaunch inputs are invalid');
  }
  const args = profileSwitchRelaunchArguments({
    argv, isPackaged, developmentEntry, switchId,
  });
  application.relaunch({ args });
  return setTimeoutFn(() => {
    Promise.resolve().then(beforeExit).catch(() => {}).finally(() => application.exit(0));
  }, delayMs);
}

function writeProfileSwitchE2EMarker({
  application,
  environment,
  userData,
  profileId,
  activeContextEpoch,
} = {}) {
  if (!application || application.isPackaged || environment?.HKUSTGZ_PROFILE_SWITCH_E2E !== '1') {
    return false;
  }
  if (typeof userData !== 'string' || !path.isAbsolute(userData) ||
      typeof profileId !== 'string' || !profileId ||
      !Number.isSafeInteger(activeContextEpoch) || activeContextEpoch <= 0) {
    throw new TypeError('Profile switch E2E marker inputs are invalid');
  }
  fs.writeFileSync(path.join(userData, 'profile-switch-e2e-ready.json'), JSON.stringify({
    profileId,
    activeContextEpoch,
    pid: process.pid,
  }), { mode: 0o600 });
  return true;
}

module.exports = {
  PROFILE_SWITCH_RELAUNCH_PREFIX,
  profileSwitchRelaunchArguments,
  relaunchAfterProfileSwitch,
  scheduleProfileSwitchRelaunch,
  switchMarker,
  writeProfileSwitchE2EMarker,
};
