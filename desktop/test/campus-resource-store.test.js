'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  deleteCustomResource,
  reorderCustomResources,
  upsertCustomResource,
} = require('../lib/campus-resource-store');
const BUILTINS = [{
  id: 'home',
  url: 'https://www.example.edu/',
  builtin: true,
}];

test('adding a shortcut generates a stable local id and partner route', () => {
  const result = upsertCustomResource([], {
    name: 'Outlook',
    description: '邮件',
    url: 'https://outlook.office.com/owa/',
  });
  assert.match(result.resource.id, /^custom-[a-f0-9]{8}$/);
  assert.equal(result.resource.route, 'direct');
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
