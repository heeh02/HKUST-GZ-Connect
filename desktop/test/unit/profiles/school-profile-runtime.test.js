'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { SchoolProfileRegistry } = require('../../../lib/profiles/registry/school-profile-registry');
const {
  createActiveSchoolProfileContext,
  engineConfigCandidate,
  readRegularFileNoFollow,
  verifyEngineConfigBinding,
} = require('../../../lib/profiles/runtime/school-profile-runtime');

const desktopRoot = path.resolve(__dirname, '..', '..', '..');

function copyConfig(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-profile-runtime-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const engineDirectory = path.join(directory, 'engine');
  fs.mkdirSync(engineDirectory);
  const target = path.join(engineDirectory, 'hkustgz.json');
  fs.copyFileSync(
    path.join(desktopRoot, '..', 'independent', 'config', 'hkustgz.json'),
    target,
  );
  return { directory, target };
}

test('active context binds the single reviewed profile to the exact source config', () => {
  const context = createActiveSchoolProfileContext({
    packageRoot: desktopRoot,
    desktopDir: desktopRoot,
  });
  assert.equal(context.profile.profileId, 'hkustgz');
  assert.equal(context.gatewayHost, 'remote.hkust-gz.edu.cn');
  assert.equal(context.gatewayPort, 443);
  assert.equal(context.builtinResources.length, 30);
  assert.equal(Object.isFrozen(context.builtinResources), true);
  assert.equal(
    context.engineConfigPath,
    path.join(desktopRoot, '..', 'independent', 'config', 'hkustgz.json'),
  );
  assert.equal(context.verifyEngineConfig().path, context.engineConfigPath);
});

test('packaged path uses only the compiled config filename', (t) => {
  const packaged = copyConfig(t);
  const context = createActiveSchoolProfileContext({
    packageRoot: desktopRoot,
    isPackaged: true,
    resourcesPath: packaged.directory,
    desktopDir: desktopRoot,
  });
  assert.equal(context.engineConfigPath, packaged.target);
});

test('reviewed Profile runtime paths derive from bounded Profile identity instead of HKUST constants', () => {
  const profile = {
    profileId: 'example-university',
    gateway: { engineConfigRef: 'example-university-engine-config' },
  };
  assert.equal(engineConfigCandidate({
    profile,
    isPackaged: true,
    resourcesPath: '/Applications/Campus Connect/Resources',
    desktopDir: desktopRoot,
  }), path.join('/Applications/Campus Connect/Resources', 'engine', 'example-university.json'));
  assert.throws(() => engineConfigCandidate({
    profile: { ...profile, profileId: '../hkustgz' },
    isPackaged: false,
    desktopDir: desktopRoot,
  }), /not compiled/u);
});

test('tampered, malformed, wrong-origin and symlink configs fail closed', {
  skip: process.platform === 'win32',
}, (t) => {
  const registry = new SchoolProfileRegistry({ packageRoot: desktopRoot }).load();
  const profile = registry.getDefaultProfile();
  for (const replacement of [
    Buffer.from('{}\n'),
    Buffer.from('{not-json}\n'),
    Buffer.from(JSON.stringify({ base_url: 'https://other.example.edu' })),
  ]) {
    const packaged = copyConfig(t);
    fs.writeFileSync(packaged.target, replacement);
    assert.throws(() => verifyEngineConfigBinding({
      registry,
      profile,
      isPackaged: true,
      resourcesPath: packaged.directory,
      desktopDir: desktopRoot,
    }), /does not match|not valid JSON|invalid schema|Gateway origin/u);
  }

  const linked = copyConfig(t);
  const original = `${linked.target}.original`;
  fs.renameSync(linked.target, original);
  fs.symlinkSync(original, linked.target);
  assert.throws(() => verifyEngineConfigBinding({
    registry,
    profile,
    isPackaged: true,
    resourcesPath: linked.directory,
    desktopDir: desktopRoot,
  }), /regular file/u);
});

test('a config path replaced by a FIFO cannot block before opened-handle validation', {
  skip: process.platform === 'win32',
}, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-profile-fifo-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fifo = path.join(directory, 'config.json');
  const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  const actual = fs.lstatSync(fifo);
  const racedFs = {
    ...fs,
    constants: fs.constants,
    lstatSync: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      size: 1,
      dev: actual.dev,
      ino: actual.ino,
    }),
  };
  assert.throws(
    () => readRegularFileNoFollow(fifo, { fsImpl: racedFs }),
    /regular file|changed while opening/u,
  );
});

test('legacy account/workspace views remain non-persistent and key-free', () => {
  const context = createActiveSchoolProfileContext({
    packageRoot: desktopRoot,
    desktopDir: desktopRoot,
  });
  const account = context.createLegacyPrimaryAccountView({ hasCredential: true });
  const workspace = context.createLegacyWorkspaceView({ resourceCount: 6 });
  assert.equal(account.kind, 'legacy-primary');
  assert.equal(workspace.persistentScope, false);
  assert.equal(JSON.stringify({ account, workspace }).includes('accountKey'), false);
});
