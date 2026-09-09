'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readPrivateFileBounded, ensureOwnerOnly } = require('../../../../lib/platform/storage/private-file');
const { collectPrivateFileReceipt } = require('../../../../lib/persistence/migration/legacy-hkust/legacy-flat-source-receipts');
const first = 2n ** 53n, second = first + 1n;
function fixture(t, { replace = true, timeField = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-exact-stat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'synthetic'); fs.writeFileSync(file, 'fixture', { mode: 0o600 });
  const io = Object.create(fs), requests = []; let reads = 0, mutations = 0, fstats = 0;
  const project = (stat, exact, ino) => ({ ...stat, ino: exact ? ino : Number(ino),
    isFile: () => stat.isFile(), isSymbolicLink: () => stat.isSymbolicLink() });
  io.lstatSync = (name, options) => {
    requests.push(options?.bigint === true);
    return project(fs.lstatSync(name, options), options?.bigint, first);
  };
  io.fstatSync = (fd, options) => {
    requests.push(options?.bigint === true);
    const value = project(fs.fstatSync(fd, options), options?.bigint, replace ? second : first);
    if (++fstats === 2 && timeField && options?.bigint) value[timeField] += 1n;
    return value;
  };
  io.readSync = (...args) => { reads++; return fs.readSync(...args); };
  io.fchmodSync = () => { mutations++; };
  const windowsAcl = { verify: () => true, tighten: () => { mutations++; return true; } };
  return { file, io, requests, windowsAcl, reads: () => reads, mutations: () => mutations };
}
test('migration receipts distinguish adjacent file identities that collide as Number', t => {
  assert.equal(Number(first), Number(second)); const f = fixture(t);
  assert.throws(() => collectPrivateFileReceipt({ file:f.file,maxBytes:32,fileSystem:f.io,windowsAcl:f.windowsAcl }), /changed while opening/);
  assert.equal(f.reads(), 0);
});
test('bounded private reads reject exact identity replacement before reading', t => {
  const f=fixture(t);
  assert.throws(() => readPrivateFileBounded(f.file,{maxBytes:32,fileSystem:f.io}), e=>e.privateFileInvalid===true);
  assert.equal(f.reads(),0);
});
test('permission hardening cannot mutate a replacement with a colliding numeric identity', t => {
  const f=fixture(t);
  assert.equal(ensureOwnerOnly(f.file,{fileSystem:f.io,windowsAcl:f.windowsAcl}),false);
  assert.equal(f.mutations(),0);
});
test('unchanged large identities remain readable and receipt sizes remain JSON numbers', t => {
  const f=fixture(t,{replace:false});
  const receipt=collectPrivateFileReceipt({file:f.file,maxBytes:32,fileSystem:f.io,windowsAcl:f.windowsAcl});
  assert.equal(receipt.bytes,7); assert.doesNotThrow(()=>JSON.stringify(receipt));
  const result=readPrivateFileBounded(f.file,{maxBytes:32,fileSystem:f.io});
  assert.equal(result.data.toString(),'fixture');assert.equal(typeof result.stat.mtimeMs,'number');
  assert.ok(f.requests.every(Boolean),'both path and descriptor stats must request exact integers');
});
for(const timeField of ['mtimeNs','ctimeNs']) test(`receipt hashing detects a one-nanosecond ${timeField} change`, t => {
  const f=fixture(t,{replace:false,timeField});
  assert.throws(()=>collectPrivateFileReceipt({file:f.file,maxBytes:32,fileSystem:f.io,windowsAcl:f.windowsAcl}),/changed while reading/);
});
test('an adapter returning unsafe numeric identities fails closed instead of inventing precision', t => {
  const f=fixture(t,{replace:false}), lstat=f.io.lstatSync;
  f.io.lstatSync=file=>lstat(file);
  assert.throws(()=>readPrivateFileBounded(f.file,{maxBytes:32,fileSystem:f.io}),e=>e.privateFileInvalid===true);
  assert.equal(ensureOwnerOnly(f.file,{fileSystem:f.io,windowsAcl:f.windowsAcl}),false);
  assert.equal(f.reads(),0);assert.equal(f.mutations(),0);
});
