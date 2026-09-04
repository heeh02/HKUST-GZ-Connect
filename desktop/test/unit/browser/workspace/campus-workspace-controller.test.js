'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  CampusWorkspaceController,
  normalizeWorkspaceCommand,
  normalizeWorkspaceRequest,
} = require('../../../../lib/browser/workspace/campus-workspace-controller');

test('Workspace command contract is ID-only bounded and one-level', () => {
  assert.deepEqual(normalizeWorkspaceCommand({ command: 'open-resource', resourceId: 'canvas' }), {
    command: 'open-resource', resourceId: 'canvas',
  });
  assert.deepEqual(normalizeWorkspaceCommand({ command: 'manage-rules' }), {
    command: 'manage-rules',
  });
  assert.deepEqual(normalizeWorkspaceCommand({ command: 'focus-address' }), {
    command: 'focus-address',
  });
  assert.deepEqual(normalizeWorkspaceCommand({
    command: 'rename-resource', resourceId: 'custom-site', name: '科研入口',
  }), {
    command: 'rename-resource', resourceId: 'custom-site', name: '科研入口',
  });
  assert.deepEqual(normalizeWorkspaceCommand({
    command: 'delete-resource', resourceId: 'custom-site',
  }), {
    command: 'delete-resource', resourceId: 'custom-site',
  });
  assert.deepEqual(normalizeWorkspaceCommand({
    command: 'move-resource', resourceId: 'canvas', groupId: 'group_abcdefghijkl', index: 2,
  }), {
    command: 'move-resource', resourceId: 'canvas', groupId: 'group_abcdefghijkl', index: 2,
  });
  assert.deepEqual(normalizeWorkspaceCommand({
    command: 'add-resources-to-group', resourceIds: ['canvas', 'sis'],
    groupId: 'group_abcdefghijkl',
  }), {
    command: 'add-resources-to-group', resourceIds: ['canvas', 'sis'],
    groupId: 'group_abcdefghijkl',
  });
  assert.equal(normalizeWorkspaceCommand({
    command: 'open-resource', resourceId: 'canvas', url: 'https://evil.example/',
  }), null);
  assert.equal(normalizeWorkspaceCommand({ command: 'create-group', name: '<script>' }), null);
  assert.equal(normalizeWorkspaceCommand({
    command: 'rename-resource', resourceId: 'custom-site', name: '<script>',
  }), null);
  assert.equal(normalizeWorkspaceCommand({
    command: 'move-resource', resourceId: 'canvas', groupId: 'nested/path', index: 0,
  }), null);
  assert.equal(normalizeWorkspaceCommand({
    command: 'add-resources-to-group', resourceIds: ['canvas', 'canvas'],
    groupId: 'group_abcdefghijkl',
  }), null);
  assert.deepEqual(normalizeWorkspaceRequest({
    requestId: 'workspace-request1',
    command: { command: 'toggle-favorite', resourceId: 'canvas' },
  }), {
    requestId: 'workspace-request1',
    command: { command: 'toggle-favorite', resourceId: 'canvas' },
  });
  assert.equal(normalizeWorkspaceRequest({
    requestId: 'workspace-request2',
    command: { command: 'open-resource', resourceId: 'canvas' },
  }), null, 'non-mutations stay on the value-free command path');
});

test('Workspace state exposes presentation only and executes validated actions', async () => {
  const commands = [];
  const controller = new CampusWorkspaceController({
    workspaceFile: '/app/workspace.html', workspacePreload: '/app/preload.js',
    getProfilePresentation: () => ({
      schoolName: 'Example University', unverified: false,
      officialPortalResourceId: 'portal', normalizedGatewayOrigin: 'must-not-cross',
    }),
    getResources: () => [{
      id: 'portal', name: 'Portal', route: 'campus', category: 'common',
      favorite: true, lastOpenedAt: null, builtin: true, url: 'must-not-cross',
    }],
    getGroups: () => [], getLocale: () => 'en',
    onCommand: async (command) => { commands.push(command); return { ok: true }; },
  });
  const state = controller.state();
  assert.equal(state.resources[0].name, 'Portal');
  assert.equal(Object.hasOwn(state.resources[0], 'url'), false);
  assert.equal(JSON.stringify(state).includes('must-not-cross'), false);

  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.sent = [];
  contents.send = (channel, payload) => { contents.sent.push([channel, payload]); };
  controller.attach(contents);
  assert.equal(controller.focus(contents, 'search', 'SIS'), true);
  assert.deepEqual(contents.sent.at(-1), [
    'campus-workspace-focus', { target: 'search', query: 'SIS' },
  ]);
  assert.equal(controller.focus(contents, 'search', 'x'.repeat(81)), false);
  contents.emit('ipc-message', {}, 'campus-workspace-command', {
    requestId: 'workspace-mutation1',
    command: { command: 'toggle-favorite', resourceId: 'portal' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(commands, [{ command: 'toggle-favorite', resourceId: 'portal' }]);
  assert.deepEqual(contents.sent.at(-1), [
    'campus-workspace-result',
    { requestId: 'workspace-mutation1', ok: true },
  ]);
  assert.equal(contents.sent.at(-2)[0], 'campus-workspace-state');
});

test('Workspace mutation reports failure and stale context without claiming success', async () => {
  const errors = [
    { ok: false, error: 'favorite write failed' },
    Object.assign(new Error('active context changed'), { code: 'stale_context' }),
  ];
  const controller = new CampusWorkspaceController({
    workspaceFile: '/app/workspace.html', workspacePreload: '/app/preload.js',
    getProfilePresentation: () => ({ schoolName: 'Example', unverified: false }),
    getResources: () => [], getGroups: () => [], getLocale: () => 'en',
    onCommand: async () => {
      const value = errors.shift();
      if (value instanceof Error) throw value;
      return value;
    },
  });
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.sent = [];
  contents.send = (channel, payload) => contents.sent.push([channel, payload]);
  controller.attach(contents);
  for (const requestId of ['workspace-failure1', 'workspace-stale1']) {
    contents.emit('ipc-message', {}, 'campus-workspace-command', {
      requestId,
      command: { command: 'create-group', name: 'Test' },
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(contents.sent, [
    ['campus-workspace-result', {
      requestId: 'workspace-failure1', ok: false,
      code: 'WORKSPACE_MUTATION_FAILED', error: 'favorite write failed',
    }],
    ['campus-workspace-result', {
      requestId: 'workspace-stale1', ok: false,
      code: 'WORKSPACE_MUTATION_STALE', error: '',
    }],
  ]);
});

test('concurrent Workspace mutations keep results correlated when completion is out of order', async () => {
  const resolvers = new Map();
  const controller = new CampusWorkspaceController({
    workspaceFile: '/app/workspace.html', workspacePreload: '/app/preload.js',
    getProfilePresentation: () => ({ schoolName: 'Example', unverified: false }),
    getResources: () => [], getGroups: () => [], getLocale: () => 'en',
    onCommand: ({ name }) => new Promise((resolve) => resolvers.set(name, resolve)),
  });
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.sent = [];
  contents.send = (channel, payload) => contents.sent.push([channel, payload]);
  controller.attach(contents);
  for (const [requestId, name] of [
    ['workspace-concurrent1', 'First'], ['workspace-concurrent2', 'Second'],
  ]) {
    contents.emit('ipc-message', {}, 'campus-workspace-command', {
      requestId, command: { command: 'create-group', name },
    });
  }
  await new Promise((resolve) => setImmediate(resolve));
  resolvers.get('Second')({ ok: false, error: 'second failed' });
  resolvers.get('First')({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  const results = contents.sent.filter(([channel]) => channel === 'campus-workspace-result');
  assert.deepEqual(results.map(([, result]) => [result.requestId, result.ok]), [
    ['workspace-concurrent2', false], ['workspace-concurrent1', true],
  ]);
});

test('a result finishing after Workspace destruction is discarded as stale', async () => {
  let resolveMutation;
  let destroyed = false;
  const controller = new CampusWorkspaceController({
    workspaceFile: '/app/workspace.html', workspacePreload: '/app/preload.js',
    getProfilePresentation: () => ({ schoolName: 'Example', unverified: false }),
    getResources: () => [], getGroups: () => [], getLocale: () => 'en',
    onCommand: () => new Promise((resolve) => { resolveMutation = resolve; }),
  });
  const contents = new EventEmitter();
  contents.isDestroyed = () => destroyed;
  contents.sent = [];
  contents.send = (channel, payload) => contents.sent.push([channel, payload]);
  controller.attach(contents);
  contents.emit('ipc-message', {}, 'campus-workspace-command', {
    requestId: 'workspace-destroyed1',
    command: { command: 'create-group', name: 'Test' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  destroyed = true;
  resolveMutation({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(contents.sent, []);
});

test('a committed mutation stays successful when the follow-up state refresh fails', async () => {
  const controller = new CampusWorkspaceController({
    workspaceFile: '/app/workspace.html', workspacePreload: '/app/preload.js',
    getProfilePresentation: () => ({ schoolName: 'Example', unverified: false }),
    getResources: () => { throw new Error('synthetic projection failure'); },
    getGroups: () => [], getLocale: () => 'en', onCommand: async () => ({ ok: true }),
  });
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.sent = [];
  contents.send = (channel, payload) => contents.sent.push([channel, payload]);
  controller.attach(contents);
  contents.emit('ipc-message', {}, 'campus-workspace-command', {
    requestId: 'workspace-refresh1',
    command: { command: 'create-group', name: 'Test' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(contents.sent, [[
    'campus-workspace-result', { requestId: 'workspace-refresh1', ok: true },
  ]]);
});

test('Workspace projection permits one resource in multiple task collections', () => {
  const controller = new CampusWorkspaceController({
    workspaceFile: '/app/workspace.html', workspacePreload: '/app/preload.js',
    getProfilePresentation: () => ({ schoolName: 'Example', unverified: false }),
    getResources: () => [{ id: 'canvas', name: 'Canvas', route: 'direct',
      category: 'courses', favorite: true, lastOpenedAt: null, builtin: true }],
    getGroups: () => [
      { id: 'group_abcdefghijkl', name: '上课', resourceIds: ['canvas'] },
      { id: 'group_bcdefghijklm', name: '科研', resourceIds: ['canvas'] },
    ],
    getLocale: () => 'zh', onCommand: async () => {},
  });
  assert.deepEqual(controller.state().groups.map(({ resourceIds }) => resourceIds),
    [['canvas'], ['canvas']]);
});
