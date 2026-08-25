'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ManagedFileTransaction,
} = require('../../lib/integrations/managed-file-transaction');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-export-'));
  fs.chmodSync(root, 0o700);
  const exports = path.join(root, 'exports');
  const workspace = path.join(root, 'workspace');
  const backup = path.join(workspace, 'integration-backups');
  fs.mkdirSync(exports, { mode: 0o700 });
  fs.mkdirSync(workspace, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let entropy = 6;
  return {
    root,
    exports,
    backup,
    transaction: new ManagedFileTransaction({
      workspaceRoot: workspace,
      backupRoot: backup,
      randomBytes: (length) => Buffer.alloc(length, ++entropy),
      ...overrides,
    }),
  };
}

test('create and replacement are owner-only atomic readback-validated and leave no backup', (t) => {
  const f = fixture(t);
  const target = path.join(f.exports, 'campus.yaml');
  let payload = Buffer.from('new configuration\n');
  const create = f.transaction.inspect(target, payload);
  assert.equal(create.change, 'create');
  assert.deepEqual(f.transaction.apply(create, payload, (value) => value.includes('configuration')), {
    changed: true,
    receipt: create.after,
  });
  assert.equal(payload.every((byte) => byte === 0), true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'new configuration\n');
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o077, 0);

  payload = Buffer.from('replacement configuration\n');
  const replace = f.transaction.inspect(target, payload);
  assert.equal(replace.change, 'replace');
  f.transaction.apply(replace, payload, () => true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'replacement configuration\n');
  assert.deepEqual(fs.readdirSync(f.backup), []);
});

test('unchanged output does not rewrite the target but still zeroizes borrowed payload', (t) => {
  const f = fixture(t);
  const target = path.join(f.exports, 'same.yaml');
  fs.writeFileSync(target, 'same\n', { mode: 0o600 });
  const before = fs.statSync(target);
  const payload = Buffer.from('same\n');
  const plan = f.transaction.inspect(target, payload);
  assert.equal(plan.change, 'unchanged');
  assert.deepEqual(f.transaction.apply(plan, payload), { changed: false, receipt: plan.after });
  const after = fs.statSync(target);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(payload.every((byte) => byte === 0), true);
});

test('target drift fails before mutation and never overwrites concurrent user edits', (t) => {
  const f = fixture(t);
  const target = path.join(f.exports, 'drift.yaml');
  fs.writeFileSync(target, 'before\n', { mode: 0o600 });
  const payload = Buffer.from('after\n');
  const plan = f.transaction.inspect(target, payload);
  fs.writeFileSync(target, 'user edit\n', { mode: 0o600 });
  assert.throws(() => f.transaction.apply(plan, payload), {
    code: 'INTEGRATION_TARGET_CHANGED',
  });
  assert.equal(fs.readFileSync(target, 'utf8'), 'user edit\n');
  assert.equal(payload.every((byte) => byte === 0), true);
});

test('payload rejection and failed post-write validation preserve or restore exact old bytes', (t) => {
  const f = fixture(t);
  const target = path.join(f.exports, 'validate.yaml');
  fs.writeFileSync(target, 'old bytes\n', { mode: 0o600 });
  let payload = Buffer.from('invalid bytes\n');
  const rejected = f.transaction.inspect(target, payload);
  assert.throws(() => f.transaction.apply(rejected, payload, () => false), {
    code: 'INTEGRATION_EXPORT_FAILED',
  });
  assert.equal(fs.readFileSync(target, 'utf8'), 'old bytes\n');

  payload = Buffer.from('candidate bytes\n');
  const rollback = f.transaction.inspect(target, payload);
  let validations = 0;
  assert.throws(() => f.transaction.apply(rollback, payload, () => ++validations === 1), {
    code: 'INTEGRATION_EXPORT_FAILED',
  });
  assert.equal(fs.readFileSync(target, 'utf8'), 'old bytes\n');
  assert.deepEqual(fs.readdirSync(f.backup), []);
});

test('symlink hard-link and missing-parent targets fail closed before any write', {
  skip: process.platform === 'win32',
}, (t) => {
  const f = fixture(t);
  const unrelated = path.join(f.root, 'unrelated');
  const target = path.join(f.exports, 'unsafe.yaml');
  fs.writeFileSync(unrelated, 'unrelated', { mode: 0o600 });
  fs.symlinkSync(unrelated, target);
  assert.throws(() => f.transaction.inspect(target, Buffer.from('new\n')), {
    code: 'INTEGRATION_EXPORT_CONFLICT',
  });
  fs.unlinkSync(target);
  fs.linkSync(unrelated, target);
  assert.throws(() => f.transaction.inspect(target, Buffer.from('new\n')), {
    code: 'INTEGRATION_EXPORT_CONFLICT',
  });
  assert.throws(() => f.transaction.inspect(
    path.join(f.root, 'missing', 'target'), Buffer.from('new\n'),
  ), { code: 'INTEGRATION_EXPORT_CONFLICT' });
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'unrelated');
});

test('simulated Windows applies protection and verification to backup and target writes', (t) => {
  const calls = [];
  const f = fixture(t, {
    platform: 'win32',
    windowsAcl: {
      protect(file) { calls.push(['protect', path.basename(file)]); return true; },
      verify(file) { calls.push(['verify', path.basename(file)]); return true; },
    },
  });
  const target = path.join(f.exports, 'windows.yaml');
  fs.writeFileSync(target, 'old\n', { mode: 0o600 });
  const payload = Buffer.from('new\n');
  f.transaction.apply(f.transaction.inspect(target, payload), payload);
  assert.ok(calls.some(([action, name]) => action === 'protect' && name.includes('backup-')));
  assert.ok(calls.some(([action, name]) => action === 'verify' && name === 'windows.yaml'));
});

test('multiple staged files can roll back all-old or finalize all-new before record commit', (t) => {
  const f = fixture(t);
  const first = path.join(f.exports, 'first.conf');
  const second = path.join(f.exports, 'second.conf');
  fs.writeFileSync(first, 'first-old\n', { mode: 0o600 });
  fs.writeFileSync(second, 'second-old\n', { mode: 0o600 });
  let firstPayload = Buffer.from('first-new\n');
  let secondPayload = Buffer.from('second-new\n');
  let firstToken = f.transaction.stage(
    f.transaction.inspect(first, firstPayload), firstPayload,
  );
  let secondToken = f.transaction.stage(
    f.transaction.inspect(second, secondPayload), secondPayload,
  );
  assert.equal(fs.readFileSync(first, 'utf8'), 'first-new\n');
  assert.equal(fs.readFileSync(second, 'utf8'), 'second-new\n');
  assert.equal(f.transaction.rollback(secondToken), true);
  assert.equal(f.transaction.rollback(firstToken), true);
  assert.equal(fs.readFileSync(first, 'utf8'), 'first-old\n');
  assert.equal(fs.readFileSync(second, 'utf8'), 'second-old\n');

  firstPayload = Buffer.from('first-final\n');
  secondPayload = Buffer.from('second-final\n');
  firstToken = f.transaction.stage(f.transaction.inspect(first, firstPayload), firstPayload);
  secondToken = f.transaction.stage(f.transaction.inspect(second, secondPayload), secondPayload);
  assert.equal(f.transaction.finalize(firstToken), true);
  assert.equal(f.transaction.finalize(secondToken), true);
  assert.throws(() => f.transaction.finalize(firstToken), /invalid or settled/u);
  assert.equal(fs.readFileSync(first, 'utf8'), 'first-final\n');
  assert.equal(fs.readFileSync(second, 'utf8'), 'second-final\n');
  assert.deepEqual(fs.readdirSync(f.backup), []);
});

test('an explicitly owned missing parent is created only at stage and removed on rollback', (t) => {
  const f = fixture(t);
  const managedRoot = path.join(f.exports, 'campus-connect');
  const target = path.join(managedRoot, 'school-a.conf');
  const payload = Buffer.from('managed\n');
  const plan = f.transaction.inspect(target, payload, { ownedParentRoot: managedRoot });
  assert.equal(plan.createParent, true);
  assert.equal(fs.existsSync(managedRoot), false, 'preview is read-only');
  const token = f.transaction.stage(plan, payload);
  assert.equal(fs.readFileSync(target, 'utf8'), 'managed\n');
  assert.equal(f.transaction.rollback(token), true);
  assert.equal(fs.existsSync(managedRoot), false);

  const finalPayload = Buffer.from('final\n');
  const finalPlan = f.transaction.inspect(target, finalPayload, { ownedParentRoot: managedRoot });
  const finalToken = f.transaction.stage(finalPlan, finalPayload);
  assert.equal(f.transaction.finalize(finalToken), true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'final\n');
});

test('staged removal is reversible until finalized and absent removal is unchanged', (t) => {
  const f = fixture(t);
  const target = path.join(f.exports, 'remove.conf');
  fs.writeFileSync(target, 'owned\n', { mode: 0o600 });
  let plan = f.transaction.inspectRemoval(target);
  assert.equal(plan.change, 'remove');
  let token = f.transaction.stage(plan, null);
  assert.equal(fs.existsSync(target), false);
  assert.equal(f.transaction.rollback(token), true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'owned\n');

  plan = f.transaction.inspectRemoval(target);
  token = f.transaction.stage(plan, null);
  assert.equal(f.transaction.finalize(token), true);
  assert.equal(fs.existsSync(target), false);
  plan = f.transaction.inspectRemoval(target);
  assert.equal(plan.change, 'unchanged');
  token = f.transaction.stage(plan, null);
  assert.equal(f.transaction.finalize(token), true);
});

test('finalized removal cleans only its exact empty app-owned parent', (t) => {
  const f = fixture(t);
  const managedRoot = path.join(f.exports, 'campus-connect');
  fs.mkdirSync(managedRoot, { mode: 0o700 });
  const target = path.join(managedRoot, 'school-a.conf');
  fs.writeFileSync(target, 'managed\n', { mode: 0o600 });
  const plan = f.transaction.inspectRemoval(target, { removeEmptyOwnedParent: managedRoot });
  const token = f.transaction.stage(plan, null);
  f.transaction.finalize(token);
  assert.equal(fs.existsSync(managedRoot), false);

  fs.mkdirSync(managedRoot, { mode: 0o700 });
  fs.writeFileSync(target, 'managed\n', { mode: 0o600 });
  fs.writeFileSync(path.join(managedRoot, 'user.conf'), 'user\n', { mode: 0o600 });
  const retained = f.transaction.stage(
    f.transaction.inspectRemoval(target, { removeEmptyOwnedParent: managedRoot }), null,
  );
  f.transaction.finalize(retained);
  assert.equal(fs.existsSync(managedRoot), true);
  assert.equal(fs.readFileSync(path.join(managedRoot, 'user.conf'), 'utf8'), 'user\n');
});
