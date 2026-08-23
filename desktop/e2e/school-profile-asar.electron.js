'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const { app } = require('electron');
const { SchoolProfileRegistry } = require('../lib/school-profile-registry');

const desktopRoot = path.join(__dirname, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-profile-asar-'));
const staging = path.join(temporaryRoot, 'staging');
const archive = path.join(temporaryRoot, 'app.asar');

async function run() {
  await app.whenReady();
  fs.mkdirSync(path.join(staging, 'assets'), { recursive: true });
  fs.cpSync(path.join(desktopRoot, 'assets', 'profiles'), path.join(staging, 'assets', 'profiles'), {
    recursive: true,
  });
  fs.copyFileSync(path.join(desktopRoot, 'assets', 'logo.svg'), path.join(staging, 'assets', 'logo.svg'));
  fs.copyFileSync(
    path.join(desktopRoot, 'assets', 'campus-resources.json'),
    path.join(staging, 'assets', 'campus-resources.json'),
  );
  await asar.createPackage(staging, archive);

  const virtualProfile = path.join(
    archive,
    'assets',
    'profiles',
    'hkustgz',
    'school-profile.json',
  );
  const virtualStat = fs.lstatSync(virtualProfile);
  const descriptor = fs.openSync(virtualProfile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const openedStat = fs.fstatSync(descriptor);
  fs.closeSync(descriptor);
  assert.notEqual(
    `${virtualStat.dev}:${virtualStat.ino}`,
    `${openedStat.dev}:${openedStat.ino}`,
    'the fixture must exercise Electron ASAR virtual-vs-opened identity semantics',
  );

  const registry = new SchoolProfileRegistry({ packageRoot: archive }).load();
  assert.equal(registry.getDefaultProfile().profileId, 'hkustgz');
  assert.equal(registry.readAsset(
    'hkustgz',
    'hkustgz-engine-config',
    'engine-config',
  ).length > 0, true);
  process.stdout.write('school profile ASAR runtime: PASS\n');
}

run().then(
  () => app.quit(),
  (error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exitCode = 1;
    app.quit();
  },
);

app.on('quit', () => {
  try { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } catch {}
});
