'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ResourceLibraryRuntime } = require('../../../../lib/resources/runtime/resource-library-runtime');

class FakeActivityStore {
  constructor(options) {
    this.options = options;
    this.favorites = { schemaVersion: 1, entries: [] };
    this.recent = { schemaVersion: 1, entries: [] };
  }
  snapshot() { return { favorites: this.favorites, recent: this.recent }; }
  toggleFavorite(resourceId) {
    this.favorites = { schemaVersion: 1, entries: [resourceId] };
    return this.favorites;
  }
  replaceFavorites(document) { this.favorites = document; return document; }
  recordOpen(resourceId) {
    this.recent = { schemaVersion: 1, entries: [{ resourceId, openedAt: 10 }] };
  }
}

const resources = [{
  id: 'outlook', name: 'Outlook', description: '', url: 'https://outlook.office.com/owa/',
  localizedName: { zh: '邮箱', en: 'Outlook' },
  localizedDescription: { zh: '', en: 'Mail and calendar' },
  route: 'direct', category: 'common', keywords: [], builtin: true,
}];

test('ID-only open resolves inside Main ownership and records activity after success', async () => {
  const requests = [];
  const context = { epoch: 1 };
  const runtime = new ResourceLibraryRuntime({
    favoritesFile: '/fixture/favorites.json',
    recentFile: '/fixture/recent.json',
    platform: 'darwin',
    loadResources: () => resources,
    captureContext: () => context,
    isContextCurrent: (value) => value === context,
    openRequest: async (request) => { requests.push(request); return { ok: true }; },
    ActivityStoreClass: FakeActivityStore,
  });
  const result = await runtime.openById('outlook');
  assert.deepEqual(requests, [{ url: 'https://outlook.office.com/owa/', route: 'direct' }]);
  assert.equal(result.resourceId, 'outlook');
  assert.equal(result.resources[0].lastOpenedAt, 10);
  assert.equal(result.resources[0].name, '邮箱');
  assert.equal(Object.hasOwn(result, 'url'), false);
});

test('resource presentation selects reviewed text for the active locale', () => {
  const runtime = new ResourceLibraryRuntime({
    favoritesFile: '/fixture/favorites.json',
    recentFile: '/fixture/recent.json',
    platform: 'darwin',
    loadResources: () => resources,
    captureContext: () => ({ epoch: 1 }),
    isContextCurrent: () => true,
    openRequest: async () => ({ ok: true }),
    ActivityStoreClass: FakeActivityStore,
  });
  assert.equal(runtime.listLocalized(null, 'zh')[0].name, '邮箱');
  assert.equal(runtime.listLocalized(null, 'en')[0].name, 'Outlook');
  assert.equal(runtime.listLocalized(null, 'en')[0].description, 'Mail and calendar');
});

test('failed or stale opens never record recent activity', async () => {
  const runtime = new ResourceLibraryRuntime({
    favoritesFile: '/fixture/favorites.json',
    recentFile: '/fixture/recent.json',
    platform: 'darwin',
    loadResources: () => resources,
    captureContext: () => ({ epoch: 1 }),
    isContextCurrent: () => true,
    openRequest: async () => ({ ok: false, error: 'offline' }),
    ActivityStoreClass: FakeActivityStore,
  });
  assert.deepEqual(await runtime.openById('outlook'), { ok: false, error: 'offline' });
  assert.deepEqual(runtime.snapshot().recent.entries, []);
  await assert.rejects(() => runtime.openById('missing'), /unavailable/u);
});

test('an already stale Profile context opens no page', async () => {
  let openCalls = 0;
  const runtime = new ResourceLibraryRuntime({
    favoritesFile: '/fixture/favorites.json',
    recentFile: '/fixture/recent.json',
    platform: 'darwin',
    loadResources: () => resources,
    captureContext: () => ({ epoch: 1 }),
    isContextCurrent: () => false,
    openRequest: async () => { openCalls += 1; return { ok: true }; },
    ActivityStoreClass: FakeActivityStore,
  });
  await assert.rejects(() => runtime.openById('outlook'), /stale/u);
  assert.equal(openCalls, 0);
});
