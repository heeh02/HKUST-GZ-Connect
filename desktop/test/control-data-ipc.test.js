'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerControlDataIpc } = require('../lib/control-data-ipc');

function fixture() {
  const handlers = new Map();
  let rules = [];
  let pins = [{ origin: 'https://campus.example', fingerprint: 'A'.repeat(64) }];
  let settings = { customResources: [] };
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
    },
    schools: {
      onboarding: {
        list: () => [],
        probe: () => ({ ok: true }),
        confirm: () => ({ ok: true }),
        cancel: () => false,
      },
      getLocale: () => 'en',
      switchProfile: async () => ({ ok: true }),
    },
    integrations: {
      list: () => [],
      prepare: async () => ({ confirmationHandle: 'integration-handle' }),
      confirm: async () => ({ ok: true }),
      cancel: () => false,
    },
  });
  return { handlers, get pins() { return pins; }, get rules() { return rules; } };
}

test('facade registers exact routing certificate resource and school channels', () => {
  const f = fixture();
  assert.deepEqual([...f.handlers.keys()], [
    'list-routing-rules',
    'save-routing-rule',
    'delete-routing-rule',
    'list-certificate-pins',
    'delete-certificate-pin',
    'save-resource',
    'delete-resource',
    'reorder-resources',
    'list-school-profiles',
    'probe-custom-gateway',
    'confirm-custom-gateway',
    'cancel-custom-gateway',
    'switch-school-profile',
    'list-integrations',
    'prepare-integration',
    'confirm-integration',
    'cancel-integration',
  ]);
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
  const invalid = await f.handlers.get('save-resource')({}, {
    name: 'Synthetic', url: 'https://resource.example.test', cookie: 'forbidden',
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.resources.length, 1);
  assert.equal((await f.handlers.get('reorder-resources')({}, [id])).ok, true);
  assert.equal((await f.handlers.get('delete-resource')({}, id)).ok, true);
});
