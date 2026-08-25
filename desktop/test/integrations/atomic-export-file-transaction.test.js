'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  AtomicExportFileTransaction,
} = require('../../lib/integrations/atomic-export-file-transaction');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-export-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, transaction: new AtomicExportFileTransaction() };
}

test('explicit single-file export is owner-only, validated, and idempotent', (t) => {
  const f = fixture(t);
  const file = path.join(f.root, 'campus.yaml');
  const payload = Buffer.from('proxies:\n  []\n');
  const plan = f.transaction.inspect(file, payload);
  assert.equal(plan.change, 'create');
  assert.equal(f.transaction.apply(plan, payload, (value) => value.includes('proxies:')).changed, true);
  assert.equal(fs.readFileSync(file).equals(payload), true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0);
  assert.equal(f.transaction.inspect(file, payload).change, 'unchanged');
});

test('target drift links and invalid generated payload never overwrite user content', {
  skip: process.platform === 'win32',
}, (t) => {
  const f = fixture(t);
  const file = path.join(f.root, 'campus.yaml');
  fs.writeFileSync(file, 'before\n', { mode: 0o600 });
  const payload = Buffer.from('after\n');
  const plan = f.transaction.inspect(file, payload);
  fs.writeFileSync(file, 'concurrent\n', { mode: 0o600 });
  assert.throws(() => f.transaction.apply(plan, payload), { code: 'INTEGRATION_TARGET_CHANGED' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'concurrent\n');

  const linked = path.join(f.root, 'linked.yaml');
  fs.symlinkSync(file, linked);
  assert.throws(() => f.transaction.inspect(linked, payload), { code: 'INTEGRATION_EXPORT_CONFLICT' });

  const invalid = f.transaction.inspect(path.join(f.root, 'invalid.yaml'), payload);
  assert.throws(() => f.transaction.apply(invalid, payload, () => false), {
    code: 'INTEGRATION_EXPORT_FAILED',
  });
  assert.equal(fs.existsSync(path.join(f.root, 'invalid.yaml')), false);
});
