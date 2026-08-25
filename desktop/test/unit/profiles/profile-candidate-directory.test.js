'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CustomGatewayConfirmationOwner } = require('../../../lib/custom-gateway-onboarding');
const { ActiveContextActivationStore } = require('../../../lib/active-context-activation-store');
const { ActiveContextSwitchBarrier } = require('../../../lib/active-context-switch-barrier');
const { ActiveContextSwitchJournalStore } = require('../../../lib/active-context-switch-store');
const { CustomProfileProvisioningRuntime } = require('../../../lib/custom-profile-provisioning-runtime');
const { ProfileCandidateDirectory } = require('../../../lib/profiles/registry/profile-candidate-directory');
const { ProfileSwitchRuntime } = require('../../../lib/profile-switch-runtime');
const {
  createSchoolProfileControllerFromCandidate,
} = require('../../../lib/profiles/runtime/school-profile-controller');
const { createProfileAccountWorkspaceLayout } = require('../../../lib/profile-workspace-layout');
const { ReviewedProfileAnchorStore } = require('../../../lib/profiles/registry/reviewed-profile-anchor-store');
const { PROTOCOL_FAMILY } = require('../../../lib/profiles/schema/school-profile-schema');

const DESKTOP = path.resolve(__dirname, '..', '..', '..');
const PROFILE_KEY = `profile-${'11'.repeat(16)}`;
const ACCOUNT_KEY = `account-${'22'.repeat(16)}`;
const WORKSPACE_KEY = `workspace-${'33'.repeat(16)}`;

function root(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-candidate-directory-'));
  fs.chmodSync(value, 0o700);
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function reviewedAuthority(userData) {
  const layout = createProfileAccountWorkspaceLayout({
    userData,
    profileKey: PROFILE_KEY,
    accountKey: ACCOUNT_KEY,
    workspaceKey: WORKSPACE_KEY,
    adoptLegacyHkustBrowserPartition: true,
  });
  const createdAt = 1_700_000_000_000;
  writeJson(layout.profile.settings, {
    schemaVersion: 1, profileId: 'hkustgz', profileRevision: 1,
    primaryAccountKey: ACCOUNT_KEY,
  });
  writeJson(layout.profile.state, {
    schemaVersion: 1, migrationId: `migration-${'44'.repeat(16)}`,
    profileId: 'hkustgz', profileRevision: 1, profileCredentialBindingRevision: 1,
    gatewayOrigin: 'https://remote.hkust-gz.edu.cn', protocolFamily: PROTOCOL_FAMILY,
  });
  writeJson(layout.account.document, {
    schemaVersion: 1, accountKey: ACCOUNT_KEY, accountRevision: 1,
    accountCredentialRevision: 1, role: 'primary', state: 'enabled', profileId: 'hkustgz',
    profileRevision: 1, gatewayOrigin: 'https://remote.hkust-gz.edu.cn',
    protocolFamily: PROTOCOL_FAMILY, workspaceKey: WORKSPACE_KEY,
    activeCredentialVersion: null, createdAt, updatedAt: createdAt,
  });
  writeJson(layout.workspace.state, {
    schemaVersion: 1, profileId: 'hkustgz', profileRevision: 1,
    accountKey: ACCOUNT_KEY, accountRevision: 1, workspaceKey: WORKSPACE_KEY,
    activeContextEpoch: 2,
  });
  writeJson(layout.workspace.settings, {
    schemaVersion: 1, autoReconnect: true, maxAttempts: 3, autoConnect: false,
    routeDomains: ['hkust-gz.edu.cn', 'hkust.edu.hk'],
  });
  writeJson(layout.workspace.localResources, { schemaVersion: 1, resources: [] });
  return { layout, createdAt };
}

function provisionCustom(userData) {
  let seed = 1;
  const owner = new CustomGatewayConfirmationOwner({
    randomBytes: (length) => Buffer.alloc(length, seed++),
    now: () => 1_800_000_000_000,
    ttlMs: 10_000,
  });
  const context = {
    profileId: 'hkustgz', profileRevision: 1,
    accountHandle: `account-${'a'.repeat(36)}`, activeContextEpoch: 2,
  };
  const view = owner.issue({
    probeResult: {
      schema_version: 1, normalized_origin: 'https://vpn.example.edu',
      https_identity_valid: true, compatibility: 'recognized_candidate',
      candidate_family: PROTOCOL_FAMILY, reported_version: 'M7.6.8R2', http_status: 200,
    },
    activeContext: context,
  });
  const confirmation = owner.consume({ confirmationHandle: view.confirmationHandle,
    activeContext: context });
  let provisionSeed = 60;
  return new CustomProfileProvisioningRuntime({
    userData,
    randomBytes: (length) => Buffer.alloc(length, ++provisionSeed),
    now: () => 1_800_000_000_100,
  }).begin(confirmation);
}

function directory(userData) {
  return new ProfileCandidateDirectory({
    userData,
    packageRoot: DESKTOP,
    desktopDir: DESKTOP,
    isPackaged: false,
  });
}

test('reviewed anchor and custom index form one restart-safe candidate directory', (t) => {
  const userData = root(t);
  const reviewed = reviewedAuthority(userData);
  const custom = provisionCustom(userData);
  const candidates = directory(userData);
  const anchored = candidates.anchorReviewedCurrent({
    profileId: 'hkustgz', profileKey: PROFILE_KEY, accountKey: ACCOUNT_KEY,
  });
  assert.equal(anchored.authority.account.createdAt, reviewed.createdAt);
  assert.equal(candidates.anchorReviewedCurrent({
    profileId: 'hkustgz', profileKey: PROFILE_KEY, accountKey: ACCOUNT_KEY,
  }).context.profileKey, PROFILE_KEY);

  const views = candidates.listViews({ locale: 'zh' });
  assert.deepEqual(views.map((view) => view.profileId), ['hkustgz', custom.profileId]);
  assert.equal(views[0].sanitizedCompatibility, 'reviewed');
  assert.equal(views[1].unverified, true);
  const encoded = JSON.stringify(views);
  for (const forbidden of [PROFILE_KEY, ACCOUNT_KEY, WORKSPACE_KEY, 'engine-config.json']) {
    assert.equal(encoded.includes(forbidden), false, forbidden);
  }

  candidates.withCandidate('hkustgz', (record) => {
    assert.equal(record.kind, 'builtin-reviewed');
    assert.equal(record.context.profileKey, PROFILE_KEY);
    assert.equal(record.authority.layout.browserPartition, 'persist:hkustgz-campus-browser');
    assert.equal(JSON.parse(record.engineLaunchBinding.stdinFrame).profileId, 'hkustgz');
  });
  candidates.withCandidate(custom.profileId, (record) => {
    assert.equal(record.kind, 'custom-local');
    assert.deepEqual(record.context, custom.context);
    assert.equal(JSON.parse(record.engineLaunchBinding.stdinFrame).profileId, custom.profileId);
  });

  const customController = createSchoolProfileControllerFromCandidate({
    directory: candidates,
    profileId: custom.profileId,
    randomBytes: (length) => Buffer.alloc(length, 7),
  });
  assert.equal(customController.browserHomeUrl, null);
  assert.deepEqual(customController.defaultRouteDomains, []);
  assert.equal(customController.browserPartition.startsWith('persist:campus-workspace-'), true);
  assert.equal(customController.activeContextBinding().activeContextEpoch, 1);
  assert.equal(JSON.parse(customController.verifyEngineLaunchBinding().stdinFrame).profileId,
    custom.profileId);
  assert.equal(customController.createPresentation({ locale: 'en' }).schoolProfile.unverified, true);

  const reviewedController = createSchoolProfileControllerFromCandidate({
    directory: candidates,
    profileId: 'hkustgz',
    randomBytes: (length) => Buffer.alloc(length, 8),
  });
  assert.equal(reviewedController.browserPartition, 'persist:hkustgz-campus-browser');
  assert.equal(reviewedController.builtInResourceCount > 0, true);

  const restarted = directory(userData);
  assert.deepEqual(restarted.listViews({ locale: 'en' }).map((view) => view.profileId),
    ['hkustgz', custom.profileId]);
});

test('reviewed anchor is additive immutable owner-only and link-free', {
  skip: process.platform === 'win32',
}, (t) => {
  const userData = root(t);
  const store = new ReviewedProfileAnchorStore({ userData });
  const value = {
    profileId: 'hkustgz', profileKey: PROFILE_KEY, accountKey: ACCOUNT_KEY,
    createdAt: 1_700_000_000_000,
  };
  assert.equal(store.ensure(value), true);
  assert.equal(store.ensure(value), false);
  assert.deepEqual(store.get('hkustgz'), value);
  assert.equal(fs.lstatSync(store.filePath).mode & 0o077, 0);
  assert.throws(() => store.ensure({ ...value, accountKey: `account-${'55'.repeat(16)}` }),
    /identity changed/u);

  fs.unlinkSync(store.filePath);
  const outside = path.join(userData, 'outside-anchor.json');
  fs.writeFileSync(outside, '{"schemaVersion":1,"entries":[]}\n', { mode: 0o600 });
  fs.symlinkSync(outside, store.filePath);
  assert.throws(() => store.read(), /private file/u);
});

test('candidate directory rejects wrong reviewed keys and unknown Profile IDs', (t) => {
  const userData = root(t);
  reviewedAuthority(userData);
  const candidates = directory(userData);
  assert.throws(() => candidates.anchorReviewedCurrent({
    profileId: 'hkustgz', profileKey: PROFILE_KEY, accountKey: `account-${'55'.repeat(16)}`,
  }), /unavailable|could not be read/u);
  assert.throws(() => candidates.withCandidate('custom-missing', () => true), /unavailable/u);
  assert.throws(() => candidates.withCandidate('hkustgz', () => true), /unavailable/u,
    'a packaged Profile is not switchable until its exact local authority is anchored');
});

test('real P4 authority alternates reviewed and custom Profiles without residue', async (t) => {
  const userData = root(t);
  reviewedAuthority(userData);
  const custom = provisionCustom(userData);
  writeJson(path.join(userData, 'global', 'settings.json'), {
    schemaVersion: 1,
    activeProfileKey: PROFILE_KEY,
    activeAccountKey: ACCOUNT_KEY,
    port: 6180,
    strictProxyAuth: true,
    proxySecurityVersion: 3,
    proxyAuthMigrationPending: false,
    closeAction: 'minimize',
    language: 'en',
    startAtLogin: false,
  });
  const candidates = directory(userData);
  const reviewed = candidates.anchorReviewedCurrent({
    profileId: 'hkustgz', profileKey: PROFILE_KEY, accountKey: ACCOUNT_KEY,
  });
  let active = reviewed.context;
  const journalStore = new ActiveContextSwitchJournalStore({
    filePath: path.join(userData, 'global', 'active-context-switch.json'),
  });
  const activationStore = new ActiveContextActivationStore({ userData });
  const barrier = new ActiveContextSwitchBarrier({
    invalidateContext: () => {},
    suspendBrowser: async () => {},
    browserBoundaryClosed: () => true,
    cancelAuth: () => {},
    cancelConnectivity: () => {},
    cancelMutations: async () => true,
    closeBrowser: async () => {},
    browserClosed: () => true,
    stopEngine: async () => ({ ok: true, cleanExit: true }),
    revokeProxyAccess: async () => true,
    clearServerState: async () => true,
  });
  const switching = new ProfileSwitchRuntime({
    directory: candidates,
    journalStore,
    activationStore,
    barrier,
    getActivePersistentContext: () => active,
    getEngineGeneration: () => null,
    activateRuntime: (record) => { active = record.context; return true; },
  });

  for (let round = 0; round < 20; round += 1) {
    const target = active.profileId === 'hkustgz' ? custom.profileId : 'hkustgz';
    const result = await switching.switchTo(target);
    assert.equal(result.status, 'activated');
    assert.equal(active.profileId, target);
    assert.equal(journalStore.read(), null);
    const global = JSON.parse(fs.readFileSync(path.join(userData, 'global', 'settings.json')));
    assert.equal(global.activeProfileKey, active.profileKey);
    assert.equal(global.activeAccountKey, active.accountKey);
  }
  assert.equal(active.activeContextEpoch, 22);
  assert.equal(candidates.listViews({ locale: 'en' }).length, 2);
  assert.equal(new ReviewedProfileAnchorStore({ userData }).read().entries.length, 1);
});
