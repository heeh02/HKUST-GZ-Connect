'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createSchoolProfileController } = require('../lib/school-profile-controller');

const desktopRoot = path.join(__dirname, '..');

function controller() {
  return createSchoolProfileController({
    packageRoot: desktopRoot,
    desktopDir: desktopRoot,
  });
}

test('composes the reviewed HKUST deployment without persistent account scope', () => {
  const profile = controller();
  assert.equal(profile.gatewayHost, 'remote.hkust-gz.edu.cn');
  assert.equal(profile.gatewayPort, 443);
  assert.deepEqual(profile.defaultRouteDomains, ['hkust-gz.edu.cn', 'hkust.edu.hk']);
  assert.equal(profile.mergeResources().length, profile.builtInResourceCount);
  assert.deepEqual(profile.projectResources().receipt, {
    sourceCount: profile.builtInResourceCount,
    visibleCount: profile.builtInResourceCount,
    conflictCount: 0,
    hiddenCount: 0,
  });
  const binding = profile.verifyEngineLaunchBinding();
  assert.equal(
    binding.path,
    path.join(desktopRoot, '..', 'independent', 'config', 'hkustgz.json'),
  );
  assert.deepEqual(JSON.parse(binding.stdinFrame), {
    type: 'engine_config_binding',
    apiVersion: 1,
    configSha256: '2a25086478bc751a686a0479a55cd3165deb9da2742b8cd20d646c94581c910a',
    gatewayOrigin: 'https://remote.hkust-gz.edu.cn',
    profileId: 'hkustgz',
    profileRevision: 1,
  });

  const presentation = profile.createPresentation();
  assert.equal(presentation.schoolProfile.profileId, 'hkustgz');
  assert.equal(presentation.schoolProfile.schoolName, '香港科技大学(广州)');
  assert.equal(presentation.campusAccount.kind, 'legacy-primary');
  assert.equal(presentation.workspace.persistentScope, false);
  for (const forbidden of ['engineConfigRef', 'reviewedDnsFallback', 'accountKey', 'workspaceKey']) {
    assert.equal(JSON.stringify(presentation).includes(forbidden), false);
  }
});

test('presentation uses an explicit locale and bounded resource count', () => {
  const presentation = controller().createPresentation({
    locale: 'en',
    hasCredential: true,
    resourceCount: 7,
  });
  assert.equal(presentation.schoolProfile.shortName, 'HKUST(GZ)');
  assert.equal(presentation.campusAccount.hasCredential, true);
  assert.equal(presentation.workspace.resourceCount, 7);
});
