'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { customProfileDocument } = require('../../lib/profiles/onboarding/custom-gateway-onboarding');
const {
  createProfileNetworkRules,
  normalizeCampusCidr,
  profileNetworkRulesView,
  validateProfileNetworkRules,
} = require('../../lib/integrations/profile-network-rules');

const reviewed = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', '..', 'assets', 'profiles', 'hkustgz', 'school-profile.json'), 'utf8'));

test('one immutable rules snapshot binds Profile, account policy, CIDRs and Gateway bypass', () => {
  const rules = createProfileNetworkRules({
    profileDocument: reviewed,
    userRules: [{
      host: 'exact.example.edu', includeSubdomains: false, route: 'campus', updatedAt: 9,
    }],
    customResources: [{ url: 'https://partner.example.edu/path', route: 'direct' }],
    serverResources: [{ url: 'https://service.example.edu/', route: 'campus' }],
    campusCidrs: ['10.90.0.0/16', '10.91.0.0/16'],
  });
  assert.equal(rules.profileId, 'hkustgz');
  assert.deepEqual(rules.gatewayBypass, ['remote.hkust-gz.edu.cn']);
  assert.deepEqual(rules.campusCidrs, ['10.90.0.0/16', '10.91.0.0/16']);
  assert.deepEqual(rules.domainPolicy.userExact, [{ host: 'exact.example.edu', route: 'campus' }]);
  assert.ok(rules.domainPolicy.builtinSubdomains.some((entry) => (
    entry.host === 'hkust-gz.edu.cn' && entry.route === 'campus'
  )));
  assert.deepEqual(rules.domainPolicy.customExact, [{ host: 'partner.example.edu', route: 'direct' }]);
  assert.deepEqual(rules.domainPolicy.serverExact, [{ host: 'service.example.edu', route: 'campus' }]);
  assert.equal(Object.isFrozen(rules.domainPolicy.userExact), true);
  assert.deepEqual(validateProfileNetworkRules(rules), rules);
  assert.deepEqual(profileNetworkRulesView(rules), {
    schemaVersion: 1,
    profileId: 'hkustgz',
    profileRevision: 1,
    rulesDigest: rules.rulesDigest,
    domainRuleCount: 20,
    campusCidrCount: 2,
  });
});

test('rules digest changes on policy change and rejects noncanonical or tampered input', () => {
  const base = createProfileNetworkRules({ profileDocument: reviewed });
  const changed = createProfileNetworkRules({
    profileDocument: reviewed,
    userRules: [{ host: 'new.example.edu', includeSubdomains: true, route: 'campus', updatedAt: 1 }],
  });
  assert.notEqual(base.rulesDigest, changed.rulesDigest);
  assert.throws(() => validateProfileNetworkRules({ ...base, profileRevision: 2 }), /digest/u);
  assert.throws(() => createProfileNetworkRules({
    profileDocument: reviewed,
    userRules: [
      { host: 'same.example.edu', includeSubdomains: true, route: 'campus', updatedAt: 1 },
      { host: 'same.example.edu', includeSubdomains: true, route: 'direct', updatedAt: 2 },
    ],
  }), /canonical and unique/u);
  assert.throws(() => createProfileNetworkRules({
    profileDocument: reviewed,
    customResources: [{ url: 'javascript:alert(1)', route: 'campus' }],
  }), /valid HTTP/u);
  const duplicateHost = createProfileNetworkRules({
    profileDocument: reviewed,
    customResources: [
      { url: 'https://same.example.edu/first', route: 'direct' },
      { url: 'https://same.example.edu/second', route: 'direct' },
    ],
  });
  assert.deepEqual(duplicateHost.domainPolicy.customExact, [{
    host: 'same.example.edu', route: 'direct',
  }], 'bookmark duplicates collapse through the same policy normalizer used by Campus Browser');
});

test('CIDR v1 is exact canonical IPv4 and custom Profiles inherit no HKUST rule', () => {
  assert.equal(normalizeCampusCidr('10.90.0.0/16'), '10.90.0.0/16');
  assert.throws(() => normalizeCampusCidr('10.90.1.1/16'), /network address/u);
  assert.throws(() => normalizeCampusCidr('2001:db8::/32'), /invalid/u);
  const custom = customProfileDocument({
    profileId: `custom-${'a'.repeat(32)}`,
    origin: 'https://vpn.example.edu',
    schoolLabel: 'Example University',
  });
  const rules = createProfileNetworkRules({ profileDocument: custom });
  assert.deepEqual(rules.domainPolicy.builtinSubdomains, []);
  assert.deepEqual(rules.gatewayBypass, ['vpn.example.edu']);
  assert.equal(JSON.stringify(rules).includes('hkust'), false);
  const configured = createProfileNetworkRules({
    profileDocument: custom,
    accountCampusDomains: ['internal.example.edu'],
  });
  assert.deepEqual(configured.domainPolicy.builtinSubdomains, [{
    host: 'internal.example.edu', route: 'campus',
  }]);
});
