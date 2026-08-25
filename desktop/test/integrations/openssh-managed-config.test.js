'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { customProfileDocument } = require('../../lib/custom-gateway-onboarding');
const {
  assertOpenSshMainTarget,
  buildOpenSshProfileBlock,
  installOpenSshInclude,
  installOpenSshProfile,
  openSshProfileTarget,
  removeOpenSshInclude,
  removeOpenSshProfile,
  validateOpenSshManagedFiles,
} = require('../../lib/integrations/openssh-managed-config');
const {
  createProfileNetworkRules,
} = require('../../lib/integrations/profile-network-rules');

const reviewed = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', '..', 'assets', 'profiles', 'hkustgz', 'school-profile.json'), 'utf8'));
const options = {
  networkRules: createProfileNetworkRules({ profileDocument: reviewed }),
  helperPath: '/Applications/Campus Connect.app/Contents/Resources/engine/ec-proxy-command-darwin-arm64',
  credentialFile: '/Users/student/Library/Application Support/Campus Connect/proxy-helper-credential.txt',
};

test('Profile config preserves rule precedence and uses only profile-bound ProxyCommand', () => {
  const block = buildOpenSshProfileBlock(options);
  assert.match(block, /Host remote\.hkust-gz\.edu\.cn\n    ProxyCommand none/u);
  assert.match(block, /Host hkust-gz\.edu\.cn \*\.hkust-gz\.edu\.cn/u);
  assert.match(block, /--profile-id "hkustgz" --credential-file/u);
  assert.match(block, /-- %h %p/u);
  assert.doesNotMatch(block, /Port 6180/u);
  assert.match(block, /Host outlook\.office\.com \*\.outlook\.office\.com\n    ProxyCommand none/u);
});

test('main Include and Profile block are idempotent removable and preserve unowned config', () => {
  const original = 'Host github.com\n    User git\n';
  const include = installOpenSshInclude(original);
  assert.equal(include.owned, true);
  const mainSource = installOpenSshInclude(include.source).source;
  assert.equal(mainSource, include.source);
  const profileSource = installOpenSshProfile('', options);
  assert.equal(validateOpenSshManagedFiles({ mainSource, profileSource, options }), true);
  assert.equal(removeOpenSshInclude(mainSource), original);
  assert.equal(removeOpenSshProfile(profileSource, 'hkustgz'), '');

  const userOwned = `${original}Include ~/.ssh/campus-connect/*.conf\n`;
  const preexisting = installOpenSshInclude(userOwned);
  assert.deepEqual(preexisting, { source: userOwned, owned: false, state: 'preexisting' });
  assert.equal(removeOpenSshInclude(preexisting.source), userOwned);
});

test('target paths are exact .ssh config and deterministic profile files on POSIX and Windows', () => {
  assert.equal(assertOpenSshMainTarget('/Users/student/.ssh/config'), '/Users/student/.ssh/config');
  assert.equal(openSshProfileTarget('/Users/student/.ssh/config', 'hkustgz'),
    '/Users/student/.ssh/campus-connect/hkustgz.conf');
  assert.equal(openSshProfileTarget('C:\\Users\\student\\.ssh\\config', 'school-a'),
    'C:\\Users\\student\\.ssh\\campus-connect\\school-a.conf');
  assert.throws(() => assertOpenSshMainTarget('/tmp/config'), /\.ssh\/config/u);
  assert.throws(() => openSshProfileTarget('/Users/student/.ssh/config', '../escape'), /identity/u);
});

test('custom Profile remains unavailable until the user defines a campus domain', () => {
  const custom = customProfileDocument({
    profileId: `custom-${'e'.repeat(32)}`,
    origin: 'https://vpn.example.edu',
    schoolLabel: 'Example University',
  });
  const empty = createProfileNetworkRules({ profileDocument: custom });
  assert.throws(() => buildOpenSshProfileBlock({ ...options, networkRules: empty }), {
    code: 'INTEGRATION_ADAPTER_UNAVAILABLE',
  });
  const configured = createProfileNetworkRules({
    profileDocument: custom,
    accountCampusDomains: ['internal.example.edu'],
  });
  assert.match(buildOpenSshProfileBlock({ ...options, networkRules: configured }),
    /Host internal\.example\.edu \*\.internal\.example\.edu/u);
});
