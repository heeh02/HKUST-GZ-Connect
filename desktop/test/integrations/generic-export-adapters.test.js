'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { customProfileDocument } = require('../../lib/custom-gateway-onboarding');
const {
  buildClashCompatibleYaml,
  buildGenericExport,
  buildManualProxyExport,
  clashRuleLines,
} = require('../../lib/integrations/generic-export-adapters');
const {
  createProfileNetworkRules,
} = require('../../lib/integrations/profile-network-rules');

const reviewed = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', '..', 'assets', 'profiles', 'hkustgz', 'school-profile.json'), 'utf8'));
const material = Object.freeze({ username: 'A'.repeat(32), password: 'B'.repeat(32) });
const credential = {
  withStrings(callback) { return callback(material.username, material.password); },
};

test('Clash and Mihomo export one Profile-bound authenticated node and precedence-ordered rules', () => {
  const rules = createProfileNetworkRules({
    profileDocument: reviewed,
    userRules: [
      { host: 'direct.example.edu', includeSubdomains: false, route: 'direct', updatedAt: 2 },
      { host: 'campus.example.edu', includeSubdomains: true, route: 'campus', updatedAt: 1 },
    ],
    campusCidrs: ['10.90.0.0/16'],
  });
  const lines = clashRuleLines(rules, 'Campus Connect - hkustgz');
  assert.equal(lines[0], 'DOMAIN,remote.hkust-gz.edu.cn,DIRECT');
  assert.ok(lines.indexOf('DOMAIN,direct.example.edu,DIRECT') <
    lines.indexOf('DOMAIN-SUFFIX,hkust-gz.edu.cn,Campus Connect - hkustgz'));
  assert.ok(lines.includes('DOMAIN-SUFFIX,campus.example.edu,Campus Connect - hkustgz'));
  assert.equal(lines.at(-1), 'IP-CIDR,10.90.0.0/16,Campus Connect - hkustgz,no-resolve');

  for (const adapterId of ['clash_yaml', 'mihomo_yaml']) {
    const yaml = buildClashCompatibleYaml({
      adapterId, port: 6180, credential, networkRules: rules,
    });
    assert.match(yaml, /name: "Campus Connect - hkustgz"/u);
    assert.match(yaml, /server: "127\.0\.0\.1"/u);
    assert.match(yaml, /port: 6180/u);
    assert.match(yaml, new RegExp(`username: ${JSON.stringify(material.username)}`, 'u'));
    assert.match(yaml, new RegExp(`password: ${JSON.stringify(material.password)}`, 'u'));
    assert.match(yaml, /udp: false/u);
    assert.match(yaml, /rules:/u);
  }
});

test('custom Profile export never inherits HKUST names domains CIDRs or routes', () => {
  const profileDocument = customProfileDocument({
    profileId: `custom-${'c'.repeat(32)}`,
    origin: 'https://vpn.example.edu',
    schoolLabel: 'Example University',
  });
  const rules = createProfileNetworkRules({ profileDocument });
  const yaml = buildClashCompatibleYaml({
    adapterId: 'clash_yaml', port: 6180, credential, networkRules: rules,
  });
  assert.match(yaml, new RegExp(`Campus Connect - ${profileDocument.profileId}`, 'u'));
  assert.doesNotMatch(yaml, /hkust|10\.90\./iu);
  assert.match(yaml, /DOMAIN,vpn\.example\.edu,DIRECT/u);
});

test('manual and PAC adapters remain bounded and declare whether credentials are embedded', () => {
  const rules = createProfileNetworkRules({ profileDocument: reviewed });
  const manual = buildManualProxyExport({ port: 6180, credential, networkRules: rules });
  const parsed = JSON.parse(manual);
  assert.equal(parsed.proxy.port, 6180);
  assert.equal(parsed.proxy.password, material.password);
  assert.equal(parsed.rulesDigest, rules.rulesDigest);

  const pac = buildGenericExport({
    adapterId: 'pac',
    networkRules: rules,
    pacSource: "function FindProxyForURL(url, host) { return 'SOCKS5 127.0.0.1:6180'; }",
  });
  assert.equal(pac.containsLocalProxyCredential, false);
  assert.equal(pac.ruleCount, 0);
  pac.payload.fill(0);
  assert.throws(() => buildGenericExport({
    adapterId: 'pac', networkRules: rules, pacSource: 'DIRECT',
  }), /PAC/u);
});
