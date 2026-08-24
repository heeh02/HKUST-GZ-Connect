'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { collectLegacyFlatSourceReceipts } = require('../lib/legacy-flat-source-receipts');
const {
  openLegacyMigrationCredential,
  readLegacyMigrationPayloads,
} = require('../lib/legacy-migration-inputs');
const { createLegacyFlatSourcePaths } = require('../lib/profile-workspace-layout');
const { normalizeSettings } = require('../lib/settings-store');

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value) => Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5),
    decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0xa5).toString('utf8'),
  };
}

function fixture(t) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-migration-inputs-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const paths = createLegacyFlatSourcePaths(userData);
  const settings = Buffer.from(JSON.stringify(normalizeSettings({
    username: 'synthetic-user',
    port: 6180,
  })), 'utf8');
  fs.writeFileSync(paths.settings, settings, { mode: 0o600 });
  fs.writeFileSync(paths.settingsBackup, settings, { mode: 0o600 });
  fs.writeFileSync(paths.vpnCredential, safeStorage().encryptString('synthetic-password'), {
    mode: 0o600,
  });
  fs.writeFileSync(paths.routingRules, 'synthetic-routing', { mode: 0o600 });
  return {
    userData,
    paths,
    expected: collectLegacyFlatSourceReceipts({ userData }),
  };
}

test('payload owner reads exact receipts through bounded private files and zeroizes on destroy', (t) => {
  const value = fixture(t);
  const owner = readLegacyMigrationPayloads({
    userData: value.userData,
    expectedReceipts: value.expected,
  });
  let observed;
  owner.withPayloads((payloads) => {
    observed = payloads.routingRules;
    assert.equal(payloads.settings.length > 0, true);
    assert.equal(payloads.externalPac, null);
  });
  assert.equal(observed.equals(Buffer.from('synthetic-routing')), true);
  assert.equal(owner.destroy(), true);
  assert.equal(observed.equals(Buffer.alloc(observed.length)), true);
  assert.throws(() => owner.withPayloads(() => {}), /destroyed/u);
  assert.equal(JSON.stringify(owner).includes('synthetic'), false);
});

test('legacy credential decrypts only into a zeroizing callback owner', (t) => {
  const value = fixture(t);
  const settings = fs.readFileSync(value.paths.settings);
  const encrypted = fs.readFileSync(value.paths.vpnCredential);
  const owner = openLegacyMigrationCredential({
    settingsBytes: settings,
    encryptedCredential: encrypted,
    safeStorage: safeStorage(),
    platform: 'darwin',
  });
  assert.deepEqual(owner.withStrings((username, password) => ({ username, password })), {
    username: 'synthetic-user',
    password: 'synthetic-password',
  });
  owner.destroy();
  assert.throws(() => owner.withStrings(() => {}), /destroyed/u);
  assert.equal(JSON.stringify(owner).includes('synthetic'), false);
});

test('changed missing unexpected and linked migration inputs fail closed', {
  skip: process.platform === 'win32',
}, (t) => {
  const changed = fixture(t);
  fs.writeFileSync(changed.paths.routingRules, 'changed', { mode: 0o600 });
  assert.throws(() => readLegacyMigrationPayloads({
    userData: changed.userData,
    expectedReceipts: changed.expected,
  }), /receipt changed/u);

  const unexpected = fixture(t);
  fs.writeFileSync(unexpected.paths.externalPac, 'unexpected', { mode: 0o600 });
  assert.throws(() => readLegacyMigrationPayloads({
    userData: unexpected.userData,
    expectedReceipts: unexpected.expected,
  }), /unexpected/u);

  const linked = fixture(t);
  const target = path.join(linked.userData, 'unrelated');
  fs.writeFileSync(target, fs.readFileSync(linked.paths.routingRules), { mode: 0o600 });
  fs.unlinkSync(linked.paths.routingRules);
  fs.symlinkSync(target, linked.paths.routingRules);
  assert.throws(() => readLegacyMigrationPayloads({
    userData: linked.userData,
    expectedReceipts: linked.expected,
  }), /could not be read/u);
  assert.equal(fs.readFileSync(target, 'utf8'), 'synthetic-routing');
});
