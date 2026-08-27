'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  FavoriteGroupStore,
  emptyGroupDocument,
  validateGroupDocument,
} = require('../../../../lib/resources/runtime/favorite-group-store');

test('favorite groups are one-level owner-only ordered collections', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-favorite-groups-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let seed = 1;
  const store = new FavoriteGroupStore({
    filePath: path.join(root, 'favorite-groups.json'),
    platform: 'darwin',
    randomBytes: () => Buffer.alloc(12, seed++),
  });
  assert.deepEqual(store.snapshot(), emptyGroupDocument());
  let document = store.create('学习');
  const learning = document.groups[0].id;
  document = store.create('科研');
  const research = document.groups[1].id;
  document = store.move('canvas', learning, 0, ['canvas', 'library']);
  assert.deepEqual(document.groups[0].resourceIds, ['canvas']);
  document = store.move('library', learning, 0, ['canvas', 'library']);
  assert.deepEqual(document.groups[0].resourceIds, ['library', 'canvas']);
  document = store.move('canvas', research, 0, ['canvas', 'library']);
  assert.deepEqual(document.groups.map(({ resourceIds }) => resourceIds), [['library'], ['canvas']]);
  document = store.reorder([research, learning]);
  assert.deepEqual(document.groups.map(({ name }) => name), ['科研', '学习']);
  document = store.rename(research, '研究');
  assert.equal(document.groups[0].name, '研究');
  document = store.remove(research);
  assert.deepEqual(document.groups.map(({ name }) => name), ['学习']);
  assert.equal(fs.statSync(path.join(root, 'favorite-groups.json')).mode & 0o077, 0);
});

test('group schema rejects nesting duplication and cross-group resource ownership', () => {
  assert.throws(() => validateGroupDocument({ schemaVersion: 1, groups: [{
    id: 'group_abcdefghijkl', name: 'A', resourceIds: ['canvas'], children: [],
  }] }), /invalid/u);
  assert.throws(() => validateGroupDocument({ schemaVersion: 1, groups: [
    { id: 'group_abcdefghijkl', name: 'A', resourceIds: ['canvas'] },
    { id: 'group_bcdefghijklm', name: 'B', resourceIds: ['canvas'] },
  ] }), /multiple/u);
});
