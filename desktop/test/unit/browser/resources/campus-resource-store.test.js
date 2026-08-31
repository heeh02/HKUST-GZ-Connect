'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  deleteCustomResource,
  hideBuiltinResource,
  reorderCustomResources,
  upsertCustomResource,
} = require('../../../../lib/browser/resources/campus-resource-store');
const BUILTINS = [{
  id: 'home',
  url: 'https://www.example.edu/',
  builtin: true,
}];

test('adding a route-less shortcut generates a stable local id and fails safe to Campus', () => {
  const result = upsertCustomResource([], {
    name: 'Outlook',
    description: '邮件',
    url: 'https://outlook.office.com/owa/',
  });
  assert.match(result.resource.id, /^custom-[a-f0-9]{8}$/);
  assert.equal(result.resource.route, 'campus');
  assert.equal(Object.hasOwn(result.resource, 'builtin'), false);
  assert.equal(result.resources.length, 1);
});

test('editing a shortcut preserves its id and replaces its fields', () => {
  const first = upsertCustomResource([], {
    name: '门户',
    url: 'https://portal.example.com',
  });
  const edited = upsertCustomResource(first.resources, {
    id: first.resource.id,
    name: '新门户',
    url: 'https://portal.example.com/home',
    route: 'campus',
  });
  assert.equal(edited.resource.id, first.resource.id);
  assert.equal(edited.resource.name, '新门户');
  assert.equal(edited.resources.length, 1);
});

test('editing a browser-captured shortcut preserves its favorite-only lifecycle', () => {
  const first = upsertCustomResource([], {
    name: 'Captured', url: 'https://captured.example.edu/', favoriteOnly: true,
  });
  const edited = upsertCustomResource(first.resources, {
    id: first.resource.id, name: 'Renamed', url: first.resource.url, route: 'campus',
  });
  assert.equal(edited.resource.favoriteOnly, true);
});

test('deleting and reordering only affect local shortcuts', () => {
  const first = upsertCustomResource([], { name: 'A', url: 'https://a.example.com' });
  const second = upsertCustomResource(first.resources, { name: 'B', url: 'https://b.example.com' });
  const reordered = reorderCustomResources(second.resources, [first.resource.id, second.resource.id]);
  assert.deepEqual(reordered.map((item) => item.id), [first.resource.id, second.resource.id]);
  const removed = deleteCustomResource(reordered, first.resource.id);
  assert.deepEqual(removed.map((item) => item.id), [second.resource.id]);
  assert.throws(() => deleteCustomResource(reordered, 'home', {
    builtinResources: BUILTINS,
  }), /内置/);
  assert.deepEqual(hideBuiltinResource([], 'home', { builtinResources: BUILTINS }), ['home']);
  assert.deepEqual(hideBuiltinResource(['home'], 'home', { builtinResources: BUILTINS }), ['home']);
  assert.throws(() => hideBuiltinResource([], 'missing', { builtinResources: BUILTINS }), /不存在/);
});

test('shortcut mutations reject invalid user input', () => {
  assert.throws(() => upsertCustomResource([], { name: '', url: 'https://example.com' }), /名称/);
  assert.throws(() => upsertCustomResource([], { name: '缺网址' }), /网址/);
  assert.throws(() => upsertCustomResource([], { name: '脚本', url: 'javascript:alert(1)' }), /HTTP/);
  assert.throws(() => upsertCustomResource([], {
    name: '本机服务', url: 'https://127.0.0.1:8443', route: 'direct',
  }), /不能设为直连/);
  assert.throws(() => upsertCustomResource([], {
    name: '重复内置网址', url: 'https://www.example.edu', route: 'campus',
  }, { builtinResources: BUILTINS }), /内置网站/);
  assert.equal(upsertCustomResource([], {
    name: '校园 IP', url: 'https://103.189.154.10:4433', route: 'campus',
  }).resource.route, 'campus');
});

test('custom shortcuts strip ordinary queries and reject temporary login parameters', () => {
  const saved = upsertCustomResource([], {
    name: '教务入口',
    url: 'https://portal.example.edu/start?view=student&lang=zh',
    route: 'campus',
  });
  assert.equal(saved.resource.url, 'https://portal.example.edu/start');
  for (const key of ['code', 'token', 'ticket', 'SAMLResponse', 'RelayState']) {
    assert.throws(() => upsertCustomResource([], {
      name: '临时登录链接',
      url: `https://portal.example.edu/callback?${key}=secret-value`,
      route: 'campus',
    }), /临时登录链接/u);
  }
});

test('same-host shortcuts share one explicit or automatic route preference', () => {
  const first = upsertCustomResource([], {
    name: 'HPC login', url: 'https://hpc.example.edu/login',
    route: 'campus', routePreference: 'campus',
  });
  const second = upsertCustomResource(first.resources, {
    name: 'HPC dashboard', url: 'https://hpc.example.edu/dashboard',
    route: 'direct', routePreference: 'direct',
  });
  assert.deepEqual(second.affectedResourceIds, [first.resource.id]);
  assert.deepEqual(second.resources.map(({ route, routePreference }) => (
    [route, routePreference || route]
  )), [['direct', 'direct'], ['direct', 'direct']]);

  const automatic = upsertCustomResource(second.resources, {
    id: second.resource.id,
    name: second.resource.name,
    url: second.resource.url,
    route: 'campus',
    routePreference: 'auto',
  });
  assert.deepEqual(automatic.affectedResourceIds, [first.resource.id]);
  assert.ok(automatic.resources.every(({ routePreference }) => routePreference === 'auto'));
});
