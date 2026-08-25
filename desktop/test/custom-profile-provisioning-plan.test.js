'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CustomGatewayConfirmationOwner,
} = require('../lib/custom-gateway-onboarding');
const {
  createCustomProfileProvisioningIdentity,
  createCustomProfileProvisioningPlan,
} = require('../lib/custom-profile-provisioning-plan');
const { PROTOCOL_FAMILY } = require('../lib/profiles/schema/school-profile-schema');

function activeContext() {
  return {
    profileId: 'hkustgz',
    profileRevision: 1,
    accountHandle: `account-${'a'.repeat(36)}`,
    activeContextEpoch: 7,
  };
}

function confirmation() {
  let seed = 0;
  const owner = new CustomGatewayConfirmationOwner({
    randomBytes: (length) => Buffer.alloc(length, ++seed),
    now: () => 1_800_000_000_000,
    ttlMs: 10_000,
  });
  const view = owner.issue({
    probeResult: {
      schema_version: 1,
      normalized_origin: 'https://vpn.example.edu',
      https_identity_valid: true,
      compatibility: 'recognized_candidate',
      candidate_family: PROTOCOL_FAMILY,
      reported_version: 'M7.6.8R2',
      http_status: 200,
    },
    schoolLabel: 'Example University',
    activeContext: activeContext(),
  });
  return owner.consume({ confirmationHandle: view.confirmationHandle, activeContext: activeContext() });
}

function identity(profileId) {
  let seed = 10;
  return createCustomProfileProvisioningIdentity({
    profileId,
    randomBytes: (length) => Buffer.alloc(length, ++seed),
  });
}

test('confirmed custom Gateway produces one credential-free isolated destination plan', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-profile-plan-'));
  try {
    const consumed = confirmation();
    const plan = createCustomProfileProvisioningPlan({
      userData,
      confirmation: consumed,
      identity: identity(consumed.draftProfileId),
      now: () => 1_800_000_000_100,
    });
    assert.equal(plan.context.profileId, consumed.draftProfileId);
    assert.equal(plan.context.activeContextEpoch, 1);
    assert.equal(plan.layout.browserPartition.startsWith('persist:campus-workspace-'), true);
    assert.notEqual(plan.layout.browserPartition, 'persist:hkustgz-campus-browser');
    assert.equal(Object.keys(plan.files).length, 11);
    const engineConfig = JSON.parse(plan.files.engineConfig.toString('utf8'));
    assert.equal(engineConfig.base_url, 'https://vpn.example.edu');
    assert.deepEqual(engineConfig.proxy.vpn_dns_servers, []);
    assert.equal(engineConfig.gateway_connector.reviewed_private_gateway_allowed, false);
    for (const [name, file] of Object.entries(plan.paths)) {
      assert.equal(path.isAbsolute(file), true, name);
      assert.equal(path.relative(userData, file).startsWith('..'), false, name);
      assert.equal(Buffer.isBuffer(plan.files[name]), true, name);
    }
    const account = JSON.parse(plan.files.account.toString('utf8'));
    const workspace = JSON.parse(plan.files.workspaceSettings.toString('utf8'));
    assert.equal(account.activeCredentialVersion, null);
    assert.deepEqual(workspace.routeDomains, []);
    assert.equal(Object.hasOwn(plan.files, 'vpnCredential'), false);
    assert.deepEqual(plan.profileDocument.policy.reviewedDnsFallback, []);
    const encoded = JSON.stringify(plan);
    for (const forbidden of ['"password":', 'TwfID']) {
      assert.equal(encoded.includes(forbidden), false, forbidden);
    }
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('plan rejects confirmation identity origin family and normalized Profile drift', () => {
  const userData = path.join(os.tmpdir(), 'custom-profile-plan-drift');
  const consumed = confirmation();
  const base = {
    userData,
    confirmation: consumed,
    identity: identity(consumed.draftProfileId),
    now: () => 1_800_000_000_100,
  };
  for (const changed of [
    { ...consumed, draftProfileId: `custom-${'9'.repeat(32)}` },
    { ...consumed, normalizedOrigin: 'https://other.example.edu' },
    { ...consumed, candidateFamily: 'atrust' },
    { ...consumed, extra: true },
  ]) {
    assert.throws(() => createCustomProfileProvisioningPlan({ ...base, confirmation: changed }));
  }
});

test('provisioning identity is random opaque and never derived from the Gateway', () => {
  const profileId = `custom-${'1'.repeat(32)}`;
  const value = identity(profileId);
  assert.equal(value.profileId, profileId);
  assert.equal(new Set([
    value.provisioningId, value.profileKey, value.accountKey, value.workspaceKey,
  ]).size, 4);
  assert.equal(JSON.stringify(value).includes('vpn.example.edu'), false);
  assert.throws(() => createCustomProfileProvisioningIdentity({
    profileId: 'hkustgz',
    randomBytes: () => Buffer.alloc(16, 1),
  }), /identity/u);
});
