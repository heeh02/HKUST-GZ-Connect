'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerControlDataIpc } = require('../../../lib/ipc/control-data-ipc');
const { registerCampusResourceIpc } = require('../../../lib/ipc/campus-resource-ipc');
const { runRoutingPolicyTransaction } = require('../../../lib/routing/rules/routing-policy-transaction');

function fixture() {
  const handlers = new Map();
  let rules = [];
  let pins = [{ origin: 'https://campus.example', fingerprint: 'A'.repeat(64) }];
  let settings = { customResources: [] };
  let favorites = { schemaVersion: 1, entries: [] };
  let groups = { schemaVersion: 2, collections: [], placements: [] };
  const runTransaction = async (build) => {
    const operations = build();
    return operations.commit();
  };
  registerControlDataIpc({
    register: (channel, handler) => handlers.set(channel, handler),
    routing: {
      policy: {
        list: () => rules.map((rule) => ({ ...rule })),
        upsert: (rule) => { rules = [rule]; return rules; },
        remove: () => { rules = []; return rules; },
        replace: (next) => { rules = next; return rules; },
        resolve: () => ({ route: 'campus', source: 'default', matchedRule: null }),
      },
      runTransaction,
    },
    certificates: {
      store: {
        list: () => pins.map((pin) => ({ ...pin })),
        delete: () => { pins = []; return pins; },
      },
    },
    resources: {
      loadSettings: () => ({ ...settings, customResources: [...settings.customResources] }),
      saveSettings: (next) => { settings = next; return settings; },
      runTransaction,
      safeResources: () => settings.customResources,
      routingPolicy: {
        resolve: () => ({ route: 'campus', source: 'default' }),
        list: () => rules.map((rule) => ({ ...rule })),
        upsert: (rule) => { rules = [rule]; return rules; },
        replace: (next) => { rules = next; return rules; },
      },
      activityStore: {
        snapshot: () => ({
          favorites,
          recent: { schemaVersion: 1, entries: [] },
        }),
        toggleFavorite: (resourceId) => {
          favorites = {
            schemaVersion: 1,
            entries: favorites.entries.includes(resourceId) ? [] : [resourceId],
          };
          return favorites;
        },
        replaceFavorites: (document) => { favorites = document; return favorites; },
        groupsSnapshot: () => groups,
        replaceGroups: (document) => { groups = document; return groups; },
        createGroup: (name) => {
          groups = {
            ...groups,
            collections: [...groups.collections,
              { id: `group_${name}`, name, createdAt: 1, updatedAt: 1 }],
          };
          return groups;
        },
        renameGroup: (groupId, name) => {
          groups = {
            ...groups,
            collections: groups.collections.map((collection) => (
              collection.id === groupId ? { ...collection, name } : collection
            )),
          };
          return groups;
        },
        moveResource: () => groups,
        listGroups: () => groups.collections.map(({ id, name }) => ({ id, name, resourceIds: [] })),
        addResourcesToGroup: () => groups,
      },
    },
    cardBoard: {
      getLayout: () => ({ schemaVersion: 1, revision: 0, placements: [], decks: [] }),
      commitLayout: (request) => ({ ok: true, request }),
      resetLayout: (request) => ({ ok: true, request }),
    },
    schools: {
      onboarding: {
        list: () => [],
        probe: () => ({ ok: true }),
        confirm: () => ({ ok: true }),
        cancel: () => false,
      },
      getLocale: () => 'en',
      isCustomGatewayEnabled: () => false,
      deleteProfile: async () => ({ ok: true }),
      switchProfile: async () => ({ ok: true }),
    },
    integrations: {
      list: () => [],
      prepare: async () => ({ confirmationHandle: 'integration-handle' }),
      confirm: async () => ({ ok: true }),
      cancel: () => false,
    },
    browser: {
      clearSiteData: async () => true,
      translate: (key) => key,
    },
  });
  return { handlers, get pins() { return pins; }, get rules() { return rules; },
    get settings() { return settings; }, get favorites() { return favorites; } };
}

test('facade registers exact routing certificate resource and school channels', () => {
  const f = fixture();
  assert.deepEqual([...f.handlers.keys()], [
    'list-routing-rules',
    'preview-routing-target',
    'save-routing-rule',
    'delete-routing-rule',
    'list-certificate-pins',
    'delete-certificate-pin',
    'save-resource',
    'create-favorite-resource',
    'delete-resource',
    'restore-builtin-resources',
    'reorder-resources',
    'toggle-resource-favorite',
    'create-favorite-group',
    'rename-favorite-group',
    'move-favorite-resource',
    'get-card-board-layout',
    'commit-card-board-layout',
    'reset-card-board-layout',
    'list-school-profiles',
    'probe-custom-gateway',
    'confirm-custom-gateway',
    'cancel-custom-gateway',
    'delete-school-profile',
    'switch-school-profile',
    'list-integrations',
    'prepare-integration',
    'confirm-integration',
    'cancel-integration',
    'clear-browser-data',
  ]);
});

test('browser-data handler has no renderer payload and clears only its active workspace', async () => {
  const f = fixture();
  assert.deepEqual(await f.handlers.get('clear-browser-data')({}), { ok: true });
  assert.equal((await f.handlers.get('clear-browser-data')({}, { profileId: 'forbidden' })).ok, false);
});

test('routing and certificate handlers validate exact identities before mutation', async () => {
  const f = fixture();
  const saved = await f.handlers.get('save-routing-rule')({}, {
    host: 'login.example.test', includeSubdomains: true, route: 'direct',
  });
  assert.equal(saved.ok, true);
  assert.equal(f.rules[0].host, 'login.example.test');
  const invalid = await f.handlers.get('save-routing-rule')({}, {
    host: 'x', includeSubdomains: false, route: 'direct', token: 'forbidden',
  });
  assert.equal(invalid.ok, false);
  assert.equal(f.rules.length, 1);

  const deleted = f.handlers.get('delete-certificate-pin')({}, {
    origin: 'https://campus.example', fingerprint: 'A'.repeat(64),
  });
  assert.equal(deleted.ok, true);
  assert.deepEqual(f.pins, []);
});

test('resource handlers preserve transactional CRUD and reject unknown IPC fields', async () => {
  const f = fixture();
  const saved = await f.handlers.get('save-resource')({}, {
    name: 'Synthetic',
    url: 'https://resource.example.test/path',
    description: 'fixture',
    route: 'direct',
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.resources.length, 1);
  const id = saved.resource.id;
  assert.equal((await f.handlers.get('toggle-resource-favorite')({}, { resourceId: id })).ok, true);
  const invalid = await f.handlers.get('save-resource')({}, {
    name: 'Synthetic', url: 'https://resource.example.test', cookie: 'forbidden',
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.resources.length, 1);
  assert.equal((await f.handlers.get('reorder-resources')({}, [id])).ok, true);
  assert.equal((await f.handlers.get('delete-resource')({}, id)).ok, true);
});

test('full URL add atomically creates and favorites a resource with an automatic route', async () => {
  const f = fixture();
  const added = await f.handlers.get('create-favorite-resource')({}, {
    name: 'HPC2 login',
    url: 'https://hpc2login.hpc.hkust-gz.edu.cn/',
    description: '',
    routePreference: 'auto',
    groupId: null,
  });
  assert.equal(added.ok, true);
  assert.equal(added.resource.url, 'https://hpc2login.hpc.hkust-gz.edu.cn/');
  assert.equal(added.resource.routePreference, 'auto');
  assert.equal(f.settings.customResources.length, 1);
  assert.deepEqual(f.favorites.entries, [added.resource.id]);
});

test('a fixed add writes the exact host into the shared personal routing policy', async () => {
  const f = fixture();
  const added = await f.handlers.get('create-favorite-resource')({}, {
    name: 'HPC2 login',
    url: 'https://hpc2login.hpc.hkust-gz.edu.cn/login?next=%2Fhome',
    description: '',
    routePreference: 'campus',
    groupId: null,
  });
  assert.equal(added.ok, true);
  assert.equal(added.resource.routePreference, 'auto');
  assert.deepEqual(f.rules, [{ host: 'hpc2login.hpc.hkust-gz.edu.cn',
    includeSubdomains: false, route: 'campus' }]);
});

test('built-in resources can be hidden persistently and restored without editing the reviewed list', async () => {
  const handlers = new Map();
  const builtin = Object.freeze({
    id: 'home', name: '学校主页', description: '', url: 'https://example.edu/',
    route: 'campus', builtin: true,
  });
  let settings = { customResources: [], hiddenBuiltinResourceIds: [] };
  const resources = () => settings.hiddenBuiltinResourceIds.includes(builtin.id) ? [] : [builtin];
  registerCampusResourceIpc({
    register: (channel, handler) => handlers.set(channel, handler),
    loadSettings: () => ({ ...settings, hiddenBuiltinResourceIds: [...settings.hiddenBuiltinResourceIds] }),
    saveSettings: (next) => { settings = next; },
    runTransaction: async (build) => build().commit(),
    safeResources: resources,
    activityStore: {
      snapshot: () => ({ favorites: { schemaVersion: 1, entries: [] } }),
      toggleFavorite: () => {},
      replaceFavorites: () => {},
      groupsSnapshot: () => ({ schemaVersion: 2, collections: [], placements: [] }),
      replaceGroups: () => {},
      createGroup: () => {},
      renameGroup: () => {},
      moveResource: () => {},
      listGroups: () => [],
      addResourcesToGroup: () => {},
    },
    routingPolicy: {
      resolve: () => ({ route: 'campus', source: 'default' }),
      list: () => [], upsert: () => {}, replace: () => {},
    },
  });
  const deleted = await handlers.get('delete-resource')({}, 'home');
  assert.equal(deleted.ok, true);
  assert.deepEqual(settings.hiddenBuiltinResourceIds, ['home']);
  assert.deepEqual(deleted.resources, []);
  const restored = await handlers.get('restore-builtin-resources')();
  assert.equal(restored.ok, true);
  assert.deepEqual(settings.hiddenBuiltinResourceIds, []);
  assert.equal(restored.resources[0].id, 'home');
});

test('add website rolls settings and favorites back when category placement fails', async () => {
  const handlers = new Map();
  let settings = { customResources: [], hiddenBuiltinResourceIds: [] };
  let favorites = { schemaVersion: 1, entries: [] };
  const emptyGroups = { schemaVersion: 2, collections: [], placements: [] };
  registerCampusResourceIpc({
    register: (channel, handler) => handlers.set(channel, handler),
    loadSettings: () => structuredClone(settings),
    saveSettings: (next) => { settings = structuredClone(next); },
    runTransaction: async (build) => runRoutingPolicyTransaction({
      ...build(), suspend: async () => {}, applyExternal: async () => {},
      applyBrowser: async () => {}, restoreExternal: async () => {},
      restoreBrowser: async () => {},
    }),
    safeResources: () => settings.customResources,
    activityStore: {
      snapshot: () => ({ favorites }),
      toggleFavorite: (resourceId) => {
        favorites = { schemaVersion: 1, entries: [resourceId] }; return favorites;
      },
      replaceFavorites: (next) => { favorites = structuredClone(next); },
      groupsSnapshot: () => emptyGroups,
      replaceGroups: () => {},
      createGroup: () => {},
      renameGroup: () => {},
      moveResource: () => {},
      listGroups: () => [{ id: 'group_abcdefghijkl', name: 'HPC', resourceIds: [] }],
      addResourcesToGroup: () => { throw new Error('placement write failed'); },
    },
    routingPolicy: {
      resolve: () => ({ route: 'campus', source: 'default' }),
      list: () => [], upsert: () => {}, replace: () => {},
    },
  });
  const result = await handlers.get('create-favorite-resource')({}, {
    name: 'HPC2', url: 'https://hpc2login.hpc.hkust-gz.edu.cn/', description: '',
    routePreference: 'campus', groupId: 'group_abcdefghijkl',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /placement write failed/u);
  assert.deepEqual(settings.customResources, []);
  assert.deepEqual(favorites.entries, []);
});

test('favorite group channels create rename and move with bounded payloads', async () => {
  const f = fixture();
  const created = await f.handlers.get('create-favorite-group')({}, { name: '科研计算' });
  assert.equal(created.ok, true);
  assert.deepEqual(created.groups, [{ id: 'group_科研计算', name: '科研计算', resourceIds: [] }]);
  const renamed = await f.handlers.get('rename-favorite-group')(
    {}, { groupId: 'group_科研计算', name: '科研' },
  );
  assert.equal(renamed.ok, true);
  assert.equal(renamed.groups[0].name, '科研');
  const moved = await f.handlers.get('move-favorite-resource')(
    {}, { resourceId: 'site-1', groupId: 'group_科研计算', index: 0 },
  );
  assert.equal(moved.ok, true);
  const invalid = await f.handlers.get('create-favorite-group')({}, { name: '', extra: 1 });
  assert.equal(invalid.ok, false);
  const invalidRename = await f.handlers.get('rename-favorite-group')({}, { groupId: 'g' });
  assert.equal(invalidRename.ok, false);
});
