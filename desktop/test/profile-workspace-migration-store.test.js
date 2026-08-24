'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  DESTINATION_RECEIPT_IDS,
  LEGACY_SOURCE_IDS,
  commitMigrationJournal,
  createPreparedMigrationJournal,
} = require('../lib/profile-workspace-migration-journal');
const {
  ProfileWorkspaceMigrationJournalStore,
} = require('../lib/profile-workspace-migration-store');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-workspace-migration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    file: path.join(directory, 'global', 'profile-account-workspace-migration.json'),
  };
}

function receipt(seed) {
  return {
    present: true,
    bytes: seed,
    sha256: seed.toString(16).padStart(64, '0'),
  };
}

function prepared(seed = 1) {
  let entropy = seed;
  return createPreparedMigrationJournal({
    profileId: 'hkustgz',
    profileRevision: 1,
    profileCredentialBindingRevision: 1,
    gatewayOrigin: 'https://remote.hkust-gz.edu.cn',
    protocolFamily: 'easyconnect-password-modern-l3-v1',
    sourceReceipts: Object.fromEntries(
      LEGACY_SOURCE_IDS.map((id, index) => [id, receipt(index + 1)]),
    ),
    randomBytes: () => Buffer.alloc(16, entropy++),
    now: () => 1_700_000_000_000,
  });
}

function committed(document) {
  return commitMigrationJournal(document, {
    destinationReceipts: Object.fromEntries(
      DESTINATION_RECEIPT_IDS.map((id, index) => [id, receipt(index + 101)]),
    ),
    now: () => 1_700_000_000_100,
  });
}

test('owner-only journal store persists one prepared to committed transition', (t) => {
  const { file } = fixture(t);
  const store = new ProfileWorkspaceMigrationJournalStore({ filePath: file });
  const first = prepared();

  assert.equal(store.read(), null);
  assert.deepEqual(store.prepare(first), { prepared: true, durabilityUnconfirmed: false });
  assert.deepEqual(store.read(), first);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.throws(() => store.prepare(prepared(20)), /already exists/u);

  const next = committed(first);
  assert.deepEqual(store.commit(next), { committed: true, durabilityUnconfirmed: false });
  assert.deepEqual(store.read(), next);
  assert.equal(store.clearCommitted(), true);
  assert.equal(store.read(), null);
  assert.equal(store.clearCommitted(), false);
});

test('prepared journal cannot be cleared or replaced by another migration identity', (t) => {
  const { file } = fixture(t);
  const store = new ProfileWorkspaceMigrationJournalStore({ filePath: file });
  const first = prepared();
  store.prepare(first);

  assert.throws(() => store.clearCommitted(), /prepared/u);
  assert.throws(() => store.commit(committed(prepared(30))), /binding/u);
  assert.deepEqual(store.read(), first);
});

test('journal reads reject symbolic links, hard links and broad POSIX permissions', {
  skip: process.platform === 'win32',
}, (t) => {
  const { directory, file } = fixture(t);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const unrelated = path.join(directory, 'unrelated.json');
  fs.writeFileSync(unrelated, JSON.stringify(prepared()), { mode: 0o600 });

  fs.symlinkSync(unrelated, file);
  assert.throws(() => new ProfileWorkspaceMigrationJournalStore({ filePath: file }).read(),
    /private file/u);
  fs.unlinkSync(file);

  fs.linkSync(unrelated, file);
  assert.throws(() => new ProfileWorkspaceMigrationJournalStore({ filePath: file }).read(),
    /private file/u);
  fs.unlinkSync(file);

  fs.copyFileSync(unrelated, file);
  fs.chmodSync(file, 0o644);
  assert.throws(() => new ProfileWorkspaceMigrationJournalStore({ filePath: file }).read(),
    /private file/u);
});

test('failure before atomic rename preserves the prepared journal', (t) => {
  const { file } = fixture(t);
  const first = prepared();
  const base = new ProfileWorkspaceMigrationJournalStore({ filePath: file });
  base.prepare(first);
  const injected = Object.create(fs);
  injected.renameSync = () => { throw new Error('simulated rename failure'); };
  const store = new ProfileWorkspaceMigrationJournalStore({ filePath: file, fileSystem: injected });

  assert.throws(() => store.commit(committed(first)), /commit/u);
  assert.deepEqual(base.read(), first);
});

test('a journal disappearing after observed presence fails closed', (t) => {
  const { file } = fixture(t);
  const base = new ProfileWorkspaceMigrationJournalStore({ filePath: file });
  base.prepare(prepared());
  const injected = Object.create(fs);
  let journalStats = 0;
  injected.lstatSync = (value, ...args) => {
    if (value === file && ++journalStats === 2) {
      fs.unlinkSync(file);
      const error = new Error('simulated disappearance');
      error.code = 'ENOENT';
      throw error;
    }
    return fs.lstatSync(value, ...args);
  };
  const store = new ProfileWorkspaceMigrationJournalStore({ filePath: file, fileSystem: injected });
  assert.throws(() => store.read(), /disappeared after it was observed/u);
});

test('a committed journal disappearing during clear is not benign absence', (t) => {
  const { file } = fixture(t);
  const first = prepared();
  const base = new ProfileWorkspaceMigrationJournalStore({ filePath: file });
  base.prepare(first);
  base.commit(committed(first));
  const injected = Object.create(fs);
  injected.unlinkSync = (value) => {
    if (value === file) {
      const error = new Error('simulated clear race');
      error.code = 'ENOENT';
      throw error;
    }
    return fs.unlinkSync(value);
  };
  const store = new ProfileWorkspaceMigrationJournalStore({ filePath: file, fileSystem: injected });
  assert.throws(() => store.clearCommitted(), /clear failed/u);
  assert.equal(fs.existsSync(file), true);
});

test('a readable committed document resolves a post-rename directory fsync failure', {
  skip: process.platform === 'win32',
}, (t) => {
  const { file } = fixture(t);
  const first = prepared();
  const base = new ProfileWorkspaceMigrationJournalStore({ filePath: file });
  base.prepare(first);
  const injected = Object.create(fs);
  let directoryFsyncs = 0;
  injected.fsyncSync = (descriptor) => {
    const stat = fs.fstatSync(descriptor);
    if (stat.isDirectory() && ++directoryFsyncs === 1) {
      throw new Error('simulated directory fsync failure');
    }
    return fs.fsyncSync(descriptor);
  };
  const store = new ProfileWorkspaceMigrationJournalStore({ filePath: file, fileSystem: injected });
  const next = committed(first);

  assert.deepEqual(store.commit(next), { committed: true, durabilityUnconfirmed: true });
  assert.deepEqual(base.read(), next);
});

test('store path must be a normalized absolute non-root path', () => {
  assert.throws(() => new ProfileWorkspaceMigrationJournalStore({ filePath: 'relative.json' }),
    /absolute/u);
  assert.throws(() => new ProfileWorkspaceMigrationJournalStore({ filePath: path.parse('/').root }),
    /absolute/u);
});

test('simulated Windows storage protects and verifies every committed journal', (t) => {
  const { file } = fixture(t);
  const protectedPaths = [];
  const verifiedPaths = [];
  const windowsAcl = {
    protect(value) { protectedPaths.push(value); return true; },
    verify(value) {
      verifiedPaths.push(value);
      return fs.existsSync(value);
    },
  };
  const store = new ProfileWorkspaceMigrationJournalStore({
    filePath: file,
    platform: 'win32',
    windowsAcl,
  });
  const first = prepared();
  assert.equal(store.read(), null);
  assert.equal(verifiedPaths.length, 0);
  store.prepare(first);
  store.commit(committed(first));
  assert.equal(store.read().state, 'committed');
  assert.equal(protectedPaths.includes(file), true);
  assert.equal(protectedPaths.some((value) => value.endsWith('.tmp')), true);
  assert.equal(verifiedPaths.filter((value) => value === file).length >= 3, true);
});

test('simulated Windows ACL failure removes a newly prepared journal', (t) => {
  const { file } = fixture(t);
  const store = new ProfileWorkspaceMigrationJournalStore({
    filePath: file,
    platform: 'win32',
    windowsAcl: { protect: () => false, verify: () => false },
  });
  assert.throws(() => store.prepare(prepared()), /prepare failed/u);
  assert.equal(fs.existsSync(file), false);
});
