'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  IntegrationRecordStore,
} = require('../../lib/integrations/integration-record-store');

function record(seed, overrides = {}) {
  return {
    schemaVersion: 1,
    adapterId: 'clash_yaml',
    adapterVersion: 1,
    profileId: 'school-a',
    bindingDigest: seed.repeat(64).slice(0, 64),
    targetFile: `/Users/student/.config/campus-connect/${seed}.yaml`,
    installedRevision: 1,
    installedDigest: seed.repeat(64).slice(0, 64),
    managedBlockId: `campus-connect-${seed}${seed}`,
    backupReference: null,
    updatedAt: 1_800_000_000_000,
    ...overrides,
  };
}

function fixture(t) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-records-'));
  fs.chmodSync(workspaceRoot, 0o700);
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const filePath = path.join(workspaceRoot, 'state', 'external-integrations.json');
  return {
    workspaceRoot,
    filePath,
    store: new IntegrationRecordStore({ workspaceRoot, filePath }),
  };
}

test('record store plans, atomically commits, reads back and idempotently replays one transition', (t) => {
  const f = fixture(t);
  const first = record('a');
  const plan = f.store.planUpsert(first);
  assert.equal(plan.before.present, false);
  assert.equal(plan.after.present, true);
  assert.equal(f.store.apply(plan), true);
  assert.equal(f.store.apply(plan), true);
  assert.deepEqual(f.store.read().records, [first]);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.filePath).mode & 0o077, 0);

  const removal = f.store.planRemove(first);
  assert.equal(f.store.apply(removal), true);
  assert.deepEqual(f.store.read().records, []);
});

test('compare-and-swap refuses a stale plan and preserves the newer record', (t) => {
  const f = fixture(t);
  const stale = f.store.planUpsert(record('a'));
  const newer = f.store.planUpsert(record('b'));
  f.store.apply(newer);
  assert.throws(() => f.store.apply(stale), /changed before commit/u);
  assert.equal(f.store.read().records[0].managedBlockId, 'campus-connect-bb');
});

test('corrupt links broad permissions and paths outside the workspace fail closed', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(f.filePath, '{bad json}', { mode: 0o600 });
  assert.throws(() => f.store.read(), /invalid/u);

  fs.unlinkSync(f.filePath);
  fs.symlinkSync('/etc/hosts', f.filePath);
  assert.throws(() => f.store.read(), /private file/u);
  assert.throws(() => new IntegrationRecordStore({
    workspaceRoot: f.workspaceRoot,
    filePath: path.join(f.workspaceRoot, '..', 'escape.json'),
  }), /escapes/u);
});

test('simulated Windows protects the temporary record and verifies committed ACL', (t) => {
  const f = fixture(t);
  const calls = [];
  const store = new IntegrationRecordStore({
    workspaceRoot: f.workspaceRoot,
    filePath: f.filePath,
    platform: 'win32',
    windowsAcl: {
      protect(file) { calls.push(['protect', path.basename(file)]); return true; },
      verify(file) { calls.push(['verify', path.basename(file)]); return true; },
    },
  });
  store.apply(store.planUpsert(record('c')));
  assert.match(calls[0][1], /^\.external-integrations\.json\..+\.tmp$/u);
  assert.deepEqual(calls.at(-1), ['verify', 'external-integrations.json']);
});

test('multiple managed targets commit or remove in one record document transition', (t) => {
  const f = fixture(t);
  const first = record('a');
  const second = record('b', {
    adapterId: 'openssh_proxy_command',
    managedBlockId: 'openssh-profile-school-a',
  });
  const install = f.store.planUpserts([first, second]);
  assert.equal(install.records.length, 2);
  f.store.apply(install);
  assert.deepEqual(f.store.read().records.map((value) => value.adapterId), [
    'clash_yaml', 'openssh_proxy_command',
  ]);
  f.store.apply(f.store.planRemovals([first, second]));
  assert.deepEqual(f.store.read().records, []);
});
