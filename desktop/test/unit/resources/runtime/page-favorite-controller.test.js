'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PageFavoriteController,
  normalizePageFavoriteCandidate,
} = require('../../../../lib/resources/runtime/page-favorite-controller');

test('captured page favorite strips transient SSO state and bounds untrusted page titles', () => {
  assert.deepEqual(normalizePageFavoriteCandidate({
    url: 'https://myportal.hkust-gz.edu.cn/?tt=opaque&RelayState=secret#fragment',
    title: '  myPortal | HKUST (GZ)  ',
    route: 'campus',
  }), {
    url: 'https://myportal.hkust-gz.edu.cn/',
    title: 'myPortal | HKUST (GZ)',
    route: 'campus',
  });
  assert.throws(() => normalizePageFavoriteCandidate({
    url: 'data:text/html,unsafe', title: 'Unsafe', route: 'direct',
  }), /HTTP/u);
});

test('one page-favorite transaction creates then toggles one local resource without duplicates', async () => {
  let settings = { customResources: [], hiddenBuiltinResourceIds: [] };
  let favorites = { schemaVersion: 1, entries: [] };
  const controller = new PageFavoriteController({
    loadSettings: () => structuredClone(settings),
    saveSettings: (next) => { settings = structuredClone(next); },
    allResources: (next) => next.customResources.map((resource) => ({
      ...resource, builtin: false, reviewed: false,
    })),
    visibleResources: (next) => next.customResources.map((resource) => ({
      ...resource, builtin: false, reviewed: false,
    })),
    activityStore: {
      snapshot: () => ({ favorites: structuredClone(favorites) }),
      toggleFavorite(resourceId) {
        favorites = {
          schemaVersion: 1,
          entries: favorites.entries.includes(resourceId)
            ? favorites.entries.filter((id) => id !== resourceId)
            : [...favorites.entries, resourceId],
        };
        return favorites;
      },
      replaceFavorites: (next) => { favorites = structuredClone(next); },
    },
    runTransaction: async (builder) => builder().commit(),
  });

  const candidate = {
    url: 'https://myportal.hkust-gz.edu.cn/?tt=opaque',
    title: 'myPortal | HKUST (GZ)', route: 'campus',
  };
  assert.deepEqual(await controller.toggle(candidate), {
    ok: true, favorite: true, resourceId: settings.customResources[0]?.id,
    removedResource: false,
  });
  assert.equal(settings.customResources.length, 1);
  assert.equal(settings.customResources[0].url, 'https://myportal.hkust-gz.edu.cn/');
  assert.equal(settings.customResources[0].favoriteOnly, true);
  assert.deepEqual(favorites.entries, [settings.customResources[0].id]);

  const second = await controller.toggle(candidate);
  assert.deepEqual(second, {
    ok: true,
    favorite: false,
    resourceId: second.resourceId,
    removedResource: true,
  });
  assert.equal(settings.customResources.length, 0);
  assert.deepEqual(favorites.entries, []);
});

test('unfavoriting a manually added website keeps the website record', async () => {
  const manual = {
    id: 'custom-manual', name: 'Manual', description: '',
    url: 'https://manual.example.edu/', route: 'campus', category: 'custom', keywords: [],
  };
  let settings = { customResources: [manual], hiddenBuiltinResourceIds: [] };
  let favorites = { schemaVersion: 1, entries: [manual.id] };
  const controller = new PageFavoriteController({
    loadSettings: () => structuredClone(settings),
    saveSettings: (next) => { settings = structuredClone(next); },
    allResources: (next) => next.customResources.map((resource) => ({
      ...resource, builtin: false, reviewed: false,
    })),
    visibleResources: (next) => next.customResources.map((resource) => ({
      ...resource, builtin: false, reviewed: false,
    })),
    activityStore: {
      snapshot: () => ({ favorites: structuredClone(favorites) }),
      toggleFavorite() {
        favorites = { schemaVersion: 1, entries: [] };
        return favorites;
      },
      replaceFavorites: (next) => { favorites = structuredClone(next); },
    },
    runTransaction: async (builder) => builder().commit(),
  });
  const result = await controller.toggle({
    url: manual.url, title: manual.name, route: manual.route,
  });
  assert.equal(result.favorite, false);
  assert.equal(result.removedResource, false);
  assert.deepEqual(settings.customResources, [manual]);
});

test('Workspace mutations keep group order and favorite ownership inside one transaction', async () => {
  const groups = { schemaVersion: 1, groups: [] };
  const favorites = { schemaVersion: 1, entries: ['canvas'] };
  const activity = {
    snapshot: () => ({ favorites }),
    groupsSnapshot: () => structuredClone(groups),
    replaceFavorites: () => {}, replaceGroups: () => {},
    toggleFavorite: () => favorites,
    createGroup(name) {
      groups.groups.push({ id: 'group_abcdefghijkl', name, resourceIds: [] }); return groups;
    },
    renameGroup(_id, name) { groups.groups[0].name = name; return groups; },
    deleteGroup() { groups.groups = []; return groups; },
    reorderGroups: () => groups,
    moveResource(resourceId, groupId) {
      groups.groups[0].resourceIds = groupId ? [resourceId] : []; return groups;
    },
  };
  const controller = new PageFavoriteController({
    loadSettings: () => ({ customResources: [], hiddenBuiltinResourceIds: [] }),
    saveSettings: () => {}, allResources: () => [],
    visibleResources: () => [{ id: 'canvas' }], activityStore: activity,
    runTransaction: async (builder) => builder().commit(),
  });
  await controller.handleWorkspaceCommand({ command: 'create-group', name: '学习' });
  await controller.handleWorkspaceCommand({
    command: 'move-resource', resourceId: 'canvas', groupId: 'group_abcdefghijkl', index: 0,
  });
  assert.deepEqual(groups.groups[0], {
    id: 'group_abcdefghijkl', name: '学习', resourceIds: ['canvas'],
  });
  await controller.handleWorkspaceCommand({
    command: 'rename-group', groupId: 'group_abcdefghijkl', name: '课程',
  });
  assert.equal(groups.groups[0].name, '课程');
});

test('batch grouping favorites missing resources and commits one multi-placement command', async () => {
  let favorites = { schemaVersion: 1, entries: ['canvas'] };
  let added = null;
  let transactions = 0;
  const resources = [{ id: 'canvas' }, { id: 'sis' }];
  const controller = new PageFavoriteController({
    loadSettings: () => ({ customResources: [], hiddenBuiltinResourceIds: [] }),
    saveSettings: () => {}, allResources: () => resources, visibleResources: () => resources,
    activityStore: {
      snapshot: () => ({ favorites: structuredClone(favorites) }),
      groupsSnapshot: () => ({ schemaVersion: 2, collections: [], placements: [] }),
      replaceFavorites: (next) => { favorites = structuredClone(next); }, replaceGroups: () => {},
      toggleFavorite(resourceId) {
        favorites = { schemaVersion: 1, entries: [...new Set([...favorites.entries, resourceId])] };
        return favorites;
      },
      addResourcesToGroup(resourceIds, groupId) { added = { resourceIds, groupId }; },
    },
    runTransaction: async (builder) => { transactions += 1; return builder().commit(); },
  });
  const result = await controller.handleWorkspaceCommand({
    command: 'add-resources-to-group', resourceIds: ['canvas', 'sis'],
    groupId: 'group_abcdefghijkl',
  });
  assert.deepEqual(added, {
    resourceIds: ['canvas', 'sis'], groupId: 'group_abcdefghijkl',
  });
  assert.deepEqual(favorites.entries, ['canvas', 'sis']);
  assert.equal(result.count, 2);
  assert.equal(transactions, 1);
});

test('Workspace can rename and delete only local websites while cleaning activity', async () => {
  let settings = {
    customResources: [{
      id: 'custom-local', name: 'Old name', description: '',
      url: 'https://local.example.edu/', route: 'campus', category: 'custom', keywords: [],
    }],
    hiddenBuiltinResourceIds: [],
  };
  let favorites = { schemaVersion: 1, entries: ['custom-local'] };
  let groups = { schemaVersion: 1, groups: [{
    id: 'group_abcdefghijkl', name: '学习', resourceIds: ['custom-local'],
  }] };
  const controller = new PageFavoriteController({
    loadSettings: () => structuredClone(settings),
    saveSettings: (next) => { settings = structuredClone(next); },
    allResources: (next) => next.customResources,
    visibleResources: (next) => next.customResources,
    activityStore: {
      snapshot: () => ({ favorites: structuredClone(favorites) }),
      groupsSnapshot: () => structuredClone(groups),
      replaceFavorites: (next) => { favorites = structuredClone(next); },
      replaceGroups: (next) => { groups = structuredClone(next); },
      removeResourceFromGroups: (resourceId) => {
        groups.groups = groups.groups.map((group) => ({
          ...group, resourceIds: group.resourceIds.filter((id) => id !== resourceId),
        }));
      },
      toggleFavorite: () => favorites,
    },
    runTransaction: async (builder) => builder().commit(),
  });
  await controller.handleWorkspaceCommand({
    command: 'rename-resource', resourceId: 'custom-local', name: '新名称',
  });
  assert.equal(settings.customResources[0].name, '新名称');
  await controller.handleWorkspaceCommand({
    command: 'delete-resource', resourceId: 'custom-local',
  });
  assert.deepEqual(settings.customResources, []);
  assert.deepEqual(favorites.entries, []);
  assert.deepEqual(groups.groups[0].resourceIds, []);
});

test('dragging a discovered website into a group favorites it before grouping', async () => {
  let favorites = { schemaVersion: 1, entries: [] };
  const groups = { schemaVersion: 1, groups: [{
    id: 'group_abcdefghijkl', name: '科研', resourceIds: [],
  }] };
  const activity = {
    snapshot: () => ({ favorites: structuredClone(favorites) }),
    groupsSnapshot: () => structuredClone(groups),
    replaceFavorites: (next) => { favorites = structuredClone(next); },
    replaceGroups: () => {},
    toggleFavorite(resourceId) {
      favorites = { schemaVersion: 1, entries: [resourceId] };
      return favorites;
    },
    moveResource(resourceId, groupId) {
      assert.deepEqual(favorites.entries, [resourceId]);
      groups.groups[0].resourceIds = groupId ? [resourceId] : [];
    },
  };
  const controller = new PageFavoriteController({
    loadSettings: () => ({ customResources: [], hiddenBuiltinResourceIds: [] }),
    saveSettings: () => {}, allResources: () => [],
    visibleResources: () => [{ id: 'lims', builtin: true }],
    activityStore: activity,
    runTransaction: async (builder) => builder().commit(),
  });
  const result = await controller.handleWorkspaceCommand({
    command: 'move-resource', resourceId: 'lims', groupId: 'group_abcdefghijkl', index: 0,
  });
  assert.deepEqual(result, { ok: true, favorite: true });
  assert.deepEqual(groups.groups[0].resourceIds, ['lims']);
});
