'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { customProfileDocument } = require('../../lib/profiles/onboarding/custom-gateway-onboarding');
const {
  assertClashVergeScriptTarget,
  buildClashVergeManagedBlock,
  installClashVergeManagedScript,
  removeClashVergeManagedScript,
  validateClashVergeManagedScript,
} = require('../../lib/integrations/clash-verge-script');
const {
  createProfileNetworkRules,
} = require('../../lib/integrations/profile-network-rules');

const reviewed = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', '..', 'assets', 'profiles', 'hkustgz', 'school-profile.json'), 'utf8'));
const credential = {
  withStrings(callback) { return callback('A'.repeat(32), 'B'.repeat(32)); },
};

function execute(source, config) {
  const context = vm.createContext({});
  new vm.Script(source).runInContext(context);
  return context.main(JSON.parse(JSON.stringify(config)), 'Synthetic Profile');
}

test('managed global extension script prepends one node and rules without replacing user arrays', () => {
  const rules = createProfileNetworkRules({ profileDocument: reviewed });
  const original = [
    'function main(config) {',
    '  config.proxies = [{ name: "Existing", type: "direct" }];',
    '  config.rules = ["MATCH,DIRECT"];',
    '  config.extra = "preserved";',
    '  return config;',
    '}',
    '',
  ].join('\n');
  const installed = installClashVergeManagedScript(original, {
    port: 6180, credential, networkRules: rules,
  });
  assert.equal(validateClashVergeManagedScript(installed, {
    port: 6180, credential, networkRules: rules,
  }), true);
  const result = execute(installed, {});
  assert.equal(result.proxies[0].name, 'Campus Connect - hkustgz');
  assert.equal(result.proxies[0].password, 'B'.repeat(32));
  assert.equal(result.proxies[1].name, 'Existing');
  assert.equal(result.rules.at(-1), 'MATCH,DIRECT');
  assert.equal(result.extra, 'preserved');
  assert.equal(removeClashVergeManagedScript(installed), original);
});

test('update replaces only the owned block and changes the active Profile binding', () => {
  const firstRules = createProfileNetworkRules({ profileDocument: reviewed });
  const custom = customProfileDocument({
    profileId: `custom-${'d'.repeat(32)}`,
    origin: 'https://vpn.example.edu',
    schoolLabel: 'Example University',
  });
  const secondRules = createProfileNetworkRules({ profileDocument: custom });
  const original = 'function main(config) { return config; }\n';
  const first = installClashVergeManagedScript(original, {
    port: 6180, credential, networkRules: firstRules,
  });
  const second = installClashVergeManagedScript(first, {
    port: 6280, credential, networkRules: secondRules,
  });
  assert.doesNotMatch(second, /Campus Connect - hkustgz/u);
  assert.match(second, new RegExp(`Campus Connect - ${custom.profileId}`, 'u'));
  assert.equal((second.match(/BEGIN CAMPUS-CONNECT MANAGED/gu) || []).length, 1);
  const result = execute(second, { proxies: [], rules: [] });
  assert.equal(result.proxies[0].port, 6280);
  assert.match(result.rules[0], /vpn\.example\.edu,DIRECT/u);
  assert.doesNotMatch(JSON.stringify(result), /hkust/iu);
});

test('adapter requires the exact selected global Script.js and rejects marker collision', () => {
  assert.equal(assertClashVergeScriptTarget('/selected/profiles/Script.js'),
    '/selected/profiles/Script.js');
  assert.throws(() => assertClashVergeScriptTarget('/selected/profiles/other.js'), /Script\.js/u);
  const rules = createProfileNetworkRules({ profileDocument: reviewed });
  assert.throws(() => installClashVergeManagedScript(
    '// BEGIN CAMPUS-CONNECT MANAGED clash-verge-rev\n',
    { port: 6180, credential, networkRules: rules },
  ), /markers conflict/u);
  assert.match(buildClashVergeManagedBlock({
    port: 6180, credential, networkRules: rules,
  }), /__campusConnectManagedV1PreviousMain/u);
});
