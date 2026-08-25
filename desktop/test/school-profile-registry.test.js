'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  SchoolProfileRegistry,
} = require('../lib/school-profile-registry');

const desktopRoot = path.join(__dirname, '..');
const sourceProfile = JSON.parse(fs.readFileSync(
  path.join(desktopRoot, 'assets', 'profiles', 'hkustgz', 'school-profile.json'),
  'utf8',
));
const sourceEngineConfig = fs.readFileSync(
  path.join(desktopRoot, 'assets', 'profiles', 'hkustgz', 'engine-config.json'),
);
const sourceLogo = fs.readFileSync(path.join(desktopRoot, 'assets', 'logo.svg'));
const sourceResources = fs.readFileSync(path.join(
  desktopRoot,
  'assets',
  'profiles',
  'hkustgz',
  'builtin-resources.json',
));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function digest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function writeFile(root, relative, data) {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}

function fixture(t, {
  mutateProfile = null,
  mutateManifest = null,
  mutateResources = null,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-profile-registry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = clone(sourceProfile);
  mutateProfile?.(profile);
  const profileData = Buffer.from(`${JSON.stringify(profile, null, 2)}\n`);
  const resources = JSON.parse(sourceResources.toString('utf8'));
  mutateResources?.(resources);
  const resourceData = mutateResources
    ? Buffer.from(`${JSON.stringify(resources, null, 2)}\n`)
    : sourceResources;
  writeFile(root, 'assets/profiles/hkustgz/school-profile.json', profileData);
  writeFile(root, 'assets/profiles/hkustgz/engine-config.json', sourceEngineConfig);
  writeFile(root, 'assets/logo.svg', sourceLogo);
  writeFile(root, 'assets/profiles/hkustgz/builtin-resources.json', resourceData);
  const manifest = {
    schemaVersion: 1,
    profiles: [{
      profileId: 'hkustgz',
      default: true,
      document: {
        path: 'assets/profiles/hkustgz/school-profile.json',
        sha256: digest(profileData),
      },
      assets: [
        {
          key: 'hkustgz-engine-config',
          kind: 'engine-config',
          path: 'assets/profiles/hkustgz/engine-config.json',
          sha256: digest(sourceEngineConfig),
        },
        {
          key: 'hkustgz-logo',
          kind: 'branding',
          path: 'assets/logo.svg',
          sha256: digest(sourceLogo),
        },
        {
          key: 'hkustgz-builtin-resources',
          kind: 'builtin-resources',
          path: 'assets/profiles/hkustgz/builtin-resources.json',
          sha256: digest(resourceData),
        },
      ],
    }],
  };
  mutateManifest?.(manifest);
  writeFile(root, 'assets/profiles/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifest, profile };
}

test('loads the reviewed single-HKUST packaged registry and bounded views', () => {
  const registry = new SchoolProfileRegistry({ packageRoot: desktopRoot }).load();
  const profile = registry.getDefaultProfile();
  assert.equal(profile.profileId, 'hkustgz');
  assert.equal(profile.evidenceClass, 'builtin-reviewed');
  assert.equal(profile.gateway.origin.origin, 'https://remote.hkust-gz.edu.cn');
  assert.equal(profile.gateway.protocolFamily, 'easyconnect-password-modern-l3-v1');
  assert.equal(profile.gateway.engineConfigRef, 'hkustgz-engine-config');
  assert.deepEqual(profile.browser.campusDomains, ['hkust-gz.edu.cn', 'hkust.edu.hk']);
  assert.deepEqual(profile.browser.healthTargets, [
    { host: 'www.hkust-gz.edu.cn', port: 443 },
    { host: 'library.hkust-gz.edu.cn', port: 443 },
  ]);
  assert.equal(profile.browser.builtinResourcesRef, 'hkustgz-builtin-resources');
  assert.equal(registry.getBuiltinResources('hkustgz').length, 6);
  assert.deepEqual(registry.listViews({ locale: 'en', compatibility: 'reviewed' }), [
    {
      schemaVersion: 1,
      profileId: 'hkustgz',
      profileRevision: 1,
      evidenceClass: 'builtin-reviewed',
      schoolName: 'The Hong Kong University of Science and Technology (Guangzhou)',
      shortName: 'HKUST(GZ)',
      bundledAssetKey: 'hkustgz-logo',
      normalizedGatewayOrigin: 'https://remote.hkust-gz.edu.cn',
      sanitizedCompatibility: 'reviewed',
      unverified: false,
    },
  ]);
});

test('manifest assets are exact, hashed, read-only copies and match current sources', () => {
  const registry = new SchoolProfileRegistry({ packageRoot: desktopRoot }).load();
  assert.deepEqual(registry.resolveAsset('hkustgz', 'hkustgz-engine-config', 'engine-config'), {
    key: 'hkustgz-engine-config',
    kind: 'engine-config',
    path: 'assets/profiles/hkustgz/engine-config.json',
    sha256: 'ed7d9d3dee309124b35f9b9921c83df4947d9c919fc009ab2b8b9b3b0457e1db',
  });
  const first = registry.readAsset('hkustgz', 'hkustgz-engine-config', 'engine-config');
  assert.deepEqual(first, fs.readFileSync(path.join(desktopRoot, '..', 'independent', 'config', 'hkustgz.json')));
  first.fill(0);
  assert.deepEqual(
    registry.readAsset('hkustgz', 'hkustgz-engine-config', 'engine-config'),
    sourceEngineConfig,
  );
  assert.throws(() => registry.readAsset('hkustgz', 'not-declared'), /not present/u);
  assert.throws(
    () => registry.resolveAsset('hkustgz', 'hkustgz-logo', 'engine-config'),
    /not present/u,
  );
});

test('package root and read-only filesystem operations are injectable', () => {
  let lstatCalls = 0;
  const fsImpl = Object.create(fs);
  fsImpl.lstatSync = (...args) => {
    lstatCalls += 1;
    return fs.lstatSync(...args);
  };
  const registry = new SchoolProfileRegistry({ packageRoot: desktopRoot, fsImpl }).load();
  assert.equal(registry.getDefaultProfile().profileId, 'hkustgz');
  assert.ok(lstatCalls > 0);
});

test('profile document contains deployment policy but no user authority', () => {
  const keys = [];
  const collectKeys = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      keys.push(key.toLowerCase());
      collectKeys(nested);
    }
  };
  collectKeys(sourceProfile);
  for (const forbidden of ['username', 'password', 'cookie', 'pin', 'userRule', 'accountKey']) {
    assert.equal(keys.includes(forbidden.toLowerCase()), false, forbidden);
  }
  assert.deepEqual(sourceProfile.browser.directPartnerDomains, [
    'outlook.office.com',
    'microsoftonline.com',
    'microsoftonline-p.com',
    'msauth.net',
    'msftauth.net',
    'office.com',
    'office.net',
    'hkust-gz.instructure.com',
    'instructure.com',
    'instructuremedia.com',
  ]);
  assert.deepEqual(sourceProfile.policy.reviewedDnsFallback, ['10.90.63.2', '10.90.63.3']);
});

test('unknown protocol families and undeclared profile references fail closed', (t) => {
  const unknownFamily = fixture(t, {
    mutateProfile: (profile) => { profile.gateway.protocolFamily = 'unknown-family'; },
  });
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: unknownFamily.root }).load(),
    /protocol family is unsupported/u,
  );

  const unknownReference = fixture(t, {
    mutateProfile: (profile) => { profile.gateway.engineConfigRef = 'unknown-config'; },
  });
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: unknownReference.root }).load(),
    /reference is not declared/u,
  );

  const unknownBranding = fixture(t, {
    mutateProfile: (profile) => { profile.branding.bundledAssetKey = 'unknown-logo'; },
  });
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: unknownBranding.root }).load(),
    /branding reference is not declared/u,
  );

  const unknownResources = fixture(t, {
    mutateProfile: (profile) => { profile.browser.builtinResourcesRef = 'unknown-resources'; },
  });
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: unknownResources.root }).load(),
    /resource reference is not declared/u,
  );
});

test('document and asset hash changes fail closed', (t) => {
  const documentFixture = fixture(t);
  fs.appendFileSync(
    path.join(documentFixture.root, 'assets', 'profiles', 'hkustgz', 'school-profile.json'),
    ' ',
  );
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: documentFixture.root }).load(),
    /document hash mismatch/u,
  );

  const assetFixture = fixture(t);
  fs.appendFileSync(path.join(assetFixture.root, 'assets', 'logo.svg'), ' ');
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: assetFixture.root }).load(),
    /asset hash mismatch/u,
  );
});

test('resource asset is the only content source and invalid reviewed entries fail closed', (t) => {
  const changed = fixture(t, {
    mutateResources: (resources) => { resources[0].name = 'n'.repeat(41); },
  });
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: changed.root }).load(),
    /resource name/u,
  );
});

test('manifest permits exactly one default hkustgz profile and known asset kinds', (t) => {
  const noDefault = fixture(t, {
    mutateManifest: (manifest) => { manifest.profiles[0].default = false; },
  });
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: noDefault.root }).load(),
    /exactly one default hkustgz/u,
  );

  const secondProfile = fixture(t, {
    mutateManifest: (manifest) => { manifest.profiles.push(clone(manifest.profiles[0])); },
  });
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: secondProfile.root }).load(),
    /duplicate profile IDs|supports only/u,
  );

  const unknownKind = fixture(t, {
    mutateManifest: (manifest) => { manifest.profiles[0].assets[0].kind = 'executable'; },
  });
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: unknownKind.root }).load(),
    /kind is unsupported/u,
  );
});

test('package-relative paths cannot escape the package root', (t) => {
  const traversal = fixture(t, {
    mutateManifest: (manifest) => {
      manifest.profiles[0].assets[0].path = '../outside.json';
    },
  });
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: traversal.root }).load(),
    /safe package-relative path/u,
  );
});

test('symlinked and non-regular packaged assets fail closed', { skip: process.platform === 'win32' }, (t) => {
  const linked = fixture(t);
  const logo = path.join(linked.root, 'assets', 'logo.svg');
  const outside = path.join(linked.root, 'outside-logo.svg');
  fs.writeFileSync(outside, sourceLogo);
  fs.unlinkSync(logo);
  fs.symlinkSync(outside, logo);
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: linked.root }).load(),
    /uses a symlink/u,
  );

  const directory = fixture(t);
  const config = path.join(directory.root, 'assets', 'profiles', 'hkustgz', 'engine-config.json');
  fs.unlinkSync(config);
  fs.mkdirSync(config);
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: directory.root }).load(),
    /invalid type/u,
  );
});

test('POSIX packaged assets must share the package owner and reject broad write access', {
  skip: process.platform === 'win32',
}, (t) => {
  const broad = fixture(t);
  const logo = path.join(broad.root, 'assets', 'logo.svg');
  fs.chmodSync(logo, 0o666);
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: broad.root }).load(),
    /group\/world writable/u,
  );

  const broadDirectory = fixture(t);
  fs.chmodSync(path.join(broadDirectory.root, 'assets', 'profiles'), 0o777);
  assert.throws(
    () => new SchoolProfileRegistry({ packageRoot: broadDirectory.root }).load(),
    /group\/world writable/u,
  );
});
