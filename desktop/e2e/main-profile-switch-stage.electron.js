'use strict';

const assert = require('node:assert/strict');
const { app, BrowserWindow, dialog } = require('electron');

dialog.showErrorBox = (title, message) => {
  process.stderr.write(`profile-switch-stage-error: ${title}: ${message}\n`);
};

const targetProfileId = process.env.HKUSTGZ_SWITCH_TARGET || '';
if (!targetProfileId) throw new Error('Profile switch stage target is missing');

require('../main');

async function waitFor(predicate, message) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function run() {
  await app.whenReady();
  const control = await waitFor(() => BrowserWindow.getAllWindows().find((window) => (
    window.webContents.getURL().endsWith('/renderer/index.html') && !window.webContents.isLoading()
  )), 'Profile switch control window did not start');
  const profiles = await control.webContents.executeJavaScript('window.api.listSchoolProfiles()');
  assert.equal(profiles.ok, true);
  assert.equal(profiles.profiles.some((profile) => (
    profile.profileId === targetProfileId && profile.active === false
  )), true);

  if (process.env.HKUSTGZ_SWITCH_OPEN_BROWSER === '1') {
    const opened = await control.webContents.executeJavaScript('window.api.openCampusBrowser({})');
    assert.equal(opened.ok, true);
    await waitFor(() => BrowserWindow.getAllWindows().some((window) => (
      window.webContents.getURL().includes('/renderer/campus-browser.html')
    )), 'Profile switch Campus Browser did not open');
  }

  const result = await control.webContents.executeJavaScript(`window.api.switchSchoolProfile({
    profileId: ${JSON.stringify(targetProfileId)}
  })`);
  assert.deepEqual(result, {
    ok: true,
    profileId: targetProfileId,
    activeContextEpoch: result.activeContextEpoch,
    relaunching: true,
  });
  assert.equal(Number.isSafeInteger(result.activeContextEpoch), true);
  assert.equal(Object.hasOwn(result, 'switchId'), false);
  assert.equal(BrowserWindow.getAllWindows().some((window) => (
    window.webContents.getURL().includes('/renderer/campus-browser.html')
  )), false, 'switch result returned before Campus Browser closed');
  process.stdout.write(`profile switch stage ${targetProfileId}: PASS\n`);
}

const hardTimeout = setTimeout(() => {
  process.stderr.write('profile switch stage timed out\n');
  app.exit(1);
}, 20_000);

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
}).finally(() => clearTimeout(hardTimeout));
