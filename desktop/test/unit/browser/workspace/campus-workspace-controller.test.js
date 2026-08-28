'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  CampusWorkspaceController,
  normalizeWorkspaceCommand,
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
    onCommand: async (command) => { commands.push(command); },
  });
  const state = controller.state();
  assert.equal(state.resources[0].name, 'Portal');
  assert.equal(Object.hasOwn(state.resources[0], 'url'), false);
  assert.equal(JSON.stringify(state).includes('must-not-cross'), false);

  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.send = (channel, payload) => { contents.sent = [channel, payload]; };
  controller.attach(contents);
  assert.equal(controller.focus(contents, 'search', 'SIS'), true);
  assert.deepEqual(contents.sent, ['campus-workspace-focus', { target: 'search', query: 'SIS' }]);
  assert.equal(controller.focus(contents, 'search', 'x'.repeat(81)), false);
  contents.emit('ipc-message', {}, 'campus-workspace-command', {
    command: 'open-resource', resourceId: 'portal',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(commands, [{ command: 'open-resource', resourceId: 'portal' }]);
  assert.equal(contents.sent[0], 'campus-workspace-state');
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
