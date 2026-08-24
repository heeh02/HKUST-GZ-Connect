'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createSchoolProfileController } = require('../lib/school-profile-controller');

const desktopRoot = path.join(__dirname, '..');

function controller(options = {}) {
  return createSchoolProfileController({
    packageRoot: desktopRoot,
    desktopDir: desktopRoot,
    ...options,
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
    protocolFamily: 'easyconnect-password-modern-l3-v1',
  });

  const presentation = profile.createPresentation();
  assert.equal(presentation.schoolProfile.profileId, 'hkustgz');
  assert.equal(presentation.schoolProfile.schoolName, '香港科技大学(广州)');
  assert.equal(presentation.campusAccount.kind, 'legacy-primary');
  assert.match(presentation.campusAccount.accountHandle, /^account-/u);
  assert.equal(
    presentation.workspace.accountHandle,
    presentation.campusAccount.accountHandle,
  );
  assert.equal(presentation.workspace.persistentScope, false);
  for (const forbidden of ['engineConfigRef', 'reviewedDnsFallback', 'accountKey', 'workspaceKey']) {
    assert.equal(JSON.stringify(presentation).includes(forbidden), false);
  }
});

test('provider capability reports become profile-bound key-free renderer snapshots', () => {
  const profile = controller({ randomBytes: () => Buffer.alloc(18, 7) });
  const capabilities = [
    'auth.password', 'auth.captcha', 'auth.sms', 'auth.token', 'auth.certificate',
    'auth.hid', 'auth.sso', 'auth.device', 'auth.unknown_secondary',
    'resource.catalogue', 'resource.authorization_decision', 'transport.l3',
    'transport.web_vpn',
  ];
  const layer = Object.fromEntries(capabilities.map((capability) => [
    capability,
    ['auth.password', 'transport.l3'].includes(capability) ? 'supported' : 'unsupported',
  ]));
  const snapshot = profile.createCapabilitySnapshot({
    profileId: 'hkustgz',
    profileRevision: 1,
    engineGeneration: 9,
    compiled: layer,
    provider: layer,
  });
  assert.equal(snapshot.profileId, 'hkustgz');
  assert.equal(snapshot.engineGeneration, 9);
  assert.equal(snapshot.effective['auth.password'], 'supported');
  assert.equal(snapshot.effective['transport.l3'], 'supported');
  assert.equal(snapshot.effective['auth.sms'], 'unsupported');
  assert.equal(snapshot.accountHandle, profile.createPresentation().campusAccount.accountHandle);
  for (const forbidden of ['accountKey', 'workspaceKey', 'protocolFamily', 'cookie', 'token']) {
    assert.equal(Object.hasOwn(snapshot, forbidden), false);
  }
  assert.throws(() => profile.createCapabilitySnapshot({
    profileId: 'other-school',
    profileRevision: 1,
    engineGeneration: 9,
    compiled: layer,
    provider: layer,
  }), /active profile/u);
  assert.equal(profile.observeCapabilityReport({
    profileId: 'hkustgz', profileRevision: 1, engineGeneration: 9,
    compiled: layer, provider: layer,
  }), true);
  assert.equal(profile.capabilitySnapshot().engineGeneration, 9);
  assert.equal(profile.observeCapabilityReport({
    profileId: 'other-school', profileRevision: 1, engineGeneration: 10,
    compiled: layer, provider: layer,
  }), false);
  assert.equal(profile.capabilitySnapshot().engineGeneration, 9);
  assert.equal(profile.clearCapabilitySnapshot(), true);
  assert.equal(profile.clearCapabilitySnapshot(), false);
});

test('process-lifetime account handles require exact entropy and erase the source buffer', () => {
  const entropy = Buffer.alloc(18, 7);
  const profile = controller({ randomBytes: () => entropy });
  assert.match(profile.createPresentation().campusAccount.accountHandle, /^account-/u);
  assert.deepEqual(entropy, Buffer.alloc(18));
  assert.throws(
    () => controller({ randomBytes: () => Buffer.alloc(17) }),
    /account handle entropy is invalid/u,
  );
  assert.throws(
    () => controller({ randomBytes: () => 'not-random-bytes' }),
    /account handle entropy is invalid/u,
  );
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
