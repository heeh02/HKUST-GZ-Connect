'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SchoolProfileRegistry } = require('../lib/school-profile-registry');
const {
  createActiveSchoolProfileContext,
  verifyEngineConfigBinding,
} = require('../lib/school-profile-runtime');

const desktopRoot = path.join(__dirname, '..');

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
