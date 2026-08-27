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
  });
  assert.equal(settings.customResources.length, 1);
  assert.equal(settings.customResources[0].url, 'https://myportal.hkust-gz.edu.cn/');
  assert.deepEqual(favorites.entries, [settings.customResources[0].id]);

  const second = await controller.toggle(candidate);
  assert.equal(second.favorite, false);
  assert.equal(settings.customResources.length, 1);
  assert.deepEqual(favorites.entries, []);
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
