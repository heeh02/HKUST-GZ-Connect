'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ResourceActivityStore } = require('../../../../lib/resources/runtime/resource-activity-store');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-activity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    store: new ResourceActivityStore({
      favoritesFile: path.join(root, 'favorites.json'),
      recentFile: path.join(root, 'recent.json'),
      now: () => 100,
      ...overrides,
    }),
  };
}

const resources = [{ id: 'home' }, { id: 'canvas' }];

test('missing activity starts empty and each mutation is owner-only and restart-safe', (t) => {
  const { root, store } = fixture(t);
  assert.deepEqual(store.snapshot(), {
    favorites: { schemaVersion: 1, entries: [] },
    recent: { schemaVersion: 1, entries: [] },
  });
  store.toggleFavorite('canvas', resources);
  store.recordOpen('home', resources);
  store.replaceRecent({
    schemaVersion: 1,
    entries: [{ resourceId: 'canvas', openedAt: 101 }],
  });
  const restarted = new ResourceActivityStore({
    favoritesFile: path.join(root, 'favorites.json'),
    recentFile: path.join(root, 'recent.json'),
  });
  assert.deepEqual(restarted.snapshot(), {
    favorites: { schemaVersion: 1, entries: ['canvas'] },
    recent: { schemaVersion: 1, entries: [{ resourceId: 'canvas', openedAt: 101 }] },
  });
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(root, 'favorites.json')).mode & 0o077, 0);
    assert.equal(fs.statSync(path.join(root, 'recent.json')).mode & 0o077, 0);
  }
});

test('corrupt or linked activity fails closed without overwriting evidence', (t) => {
  const { root, store } = fixture(t);
  const favorites = path.join(root, 'favorites.json');
  fs.writeFileSync(favorites, '{bad', { mode: 0o600 });
  assert.throws(() => store.toggleFavorite('home', resources), /invalid/u);
  assert.equal(fs.readFileSync(favorites, 'utf8'), '{bad');
  fs.unlinkSync(favorites);
  const target = path.join(root, 'target.json');
  fs.writeFileSync(target, '{"secret":true}', { mode: 0o600 });
  fs.symlinkSync(target, favorites);
  assert.throws(() => store.snapshot());
  assert.equal(fs.readFileSync(target, 'utf8'), '{"secret":true}');
});
