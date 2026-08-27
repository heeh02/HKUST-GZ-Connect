'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { CampusWorkspaceController } = require('../lib/browser/workspace/campus-workspace-controller');
const {
  parseBuiltinResourceDocument,
} = require('../lib/resources/schema/campus-resource-contract');

const favoriteTimes = new Map([
  ['canvas', [true, 900]], ['library', [true, 800]], ['outlook', [true, 600]],
  ['sis', [false, 500]], ['class-schedule', [false, 400]], ['room-booking', [false, 300]],
]);
const reviewed = parseBuiltinResourceDocument(fs.readFileSync(path.join(
  __dirname, '..', 'assets', 'profiles', 'hkustgz', 'builtin-resources.json',
)));
const resources = Object.freeze([
  ...reviewed.map((resource) => {
    const [favorite = false, lastOpenedAt = null] = favoriteTimes.get(resource.id) || [];
    return Object.freeze({
      ...resource,
      name: resource.localizedName.zh,
      description: resource.localizedDescription.zh,
      favorite,
      lastOpenedAt,
    });
  }),
  Object.freeze({
    id: 'hpc', name: 'HPC 登录入口', description: 'Fixture',
    url: 'https://hpc.example.edu/', category: 'custom', route: 'campus',
    favorite: true, lastOpenedAt: 700, builtin: false, keywords: ['HPC'],
  }),
]);

async function inspect(window) {
  return window.webContents.executeJavaScript(`(() => {
    const serviceContainer = document.getElementById('servicesGrid');
    const serviceGrid = serviceContainer.querySelector('.resource-grid') || serviceContainer;
    const serviceColumns = getComputedStyle(serviceGrid).gridTemplateColumns
      .split(' ').filter(Boolean).length;
    const serviceModules = serviceContainer.classList.contains('task-service-groups')
      ? getComputedStyle(serviceContainer).gridTemplateColumns.split(' ').filter(Boolean).length : 1;
    const groupGrid = document.querySelector('.favorite-group .resource-grid');
    const groupColumns = groupGrid
      ? getComputedStyle(groupGrid).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    const groupContainer = document.getElementById('favoriteGroups');
    const groupModules = getComputedStyle(groupContainer).gridTemplateColumns
      .split(' ').filter(Boolean).length;
    return {
      width: innerWidth,
      columns: serviceColumns * serviceModules,
      groupColumns,
      groupModules,
      cards: new Set([...document.querySelectorAll('.resource-item')].map((card) => card.dataset.resourceId)).size,
      visibleCards: [...document.querySelectorAll('.resource-item')].filter((card) => !card.hidden).length,
      hasSearch: !!document.getElementById('workspaceSearch'),
      chipLabels: [...document.querySelectorAll('.filter-button')].map((button) => button.textContent.trim()),
      officialVisible: !document.getElementById('officialLaunch').hidden,
    };
  })()`);
}

async function capture(window, label) {
  const output = process.env.HKUSTGZ_WORKSPACE_SCREENSHOT_DIR;
  if (!output) return;
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${label}.png`), (await window.webContents.capturePage()).toPNG());
}

async function main() {
  await app.whenReady();
  const commands = [];
  const window = new BrowserWindow({
    width: 1040, height: 740, show: false, backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: path.join(__dirname, '..', 'lib', 'browser', 'workspace', 'campus-workspace-preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
    },
  });
  const controller = new CampusWorkspaceController({
    workspaceFile: path.join(__dirname, '..', 'renderer', 'campus-workspace.html'),
    workspacePreload: path.join(__dirname, '..', 'lib', 'browser', 'workspace', 'campus-workspace-preload.js'),
    getProfilePresentation: () => ({
      schoolName: '香港科技大学（广州）', unverified: false,
      officialPortalResourceId: 'official-portal',
    }),
    getResources: () => resources,
    getGroups: () => [{ id: 'group_abcdefghijkl', name: '学习', resourceIds: ['canvas', 'library'] }],
    getLocale: () => 'zh',
    onCommand: async (command) => { commands.push(command); return { ok: true }; },
  });
  controller.attach(window.webContents);
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'campus-workspace.html'));
  controller.sendState(window.webContents);

  for (const [label, width, height, minimumColumns] of [
    ['compact', 660, 560, 2],
    ['standard', 1040, 740, 3],
    ['wide', 1400, 900, 4],
  ]) {
    window.setContentSize(width, height);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const state = await inspect(window);
    process.stdout.write(`${label}: ${JSON.stringify(state)}\n`);
    assert.equal(state.width, width);
    assert.equal(state.cards, resources.length - 1);
    assert.equal(state.hasSearch, true);
    assert.equal(state.officialVisible, true);
    assert.ok(state.columns >= minimumColumns, `${label} did not use available width`);
    assert.ok(state.groupColumns * state.groupModules >= minimumColumns,
      `${label} group layout did not use available width`);
    await capture(window, label);
  }

  const taskTaxonomy = await window.webContents.executeJavaScript(`(() => {
    const visibleIds = () => [...new Set([...document.querySelectorAll('.resource-item')]
      .filter((card) => !card.closest('[hidden]')).map((card) => card.dataset.resourceId))];
    const search = document.getElementById('workspaceSearch');
    search.value = '请假';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const leave = visibleIds().sort();
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.filter-button')]
      .find((button) => button.textContent === '缴费与报销').click();
    const finance = visibleIds().sort();
    [...document.querySelectorAll('.filter-button')]
      .find((button) => button.textContent === '全部').click();
    return { leave, finance };
  })()`);
  assert.deepEqual(taskTaxonomy.leave, ['e-form', 'student-request-guide']);
  assert.deepEqual(taskTaxonomy.finance, ['e-tender', 'pbms', 'student-finance']);

  const filtered = await window.webContents.executeJavaScript(`(() => {
    const search = document.getElementById('workspaceSearch');
    search.value = 'Canvas';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    return [...new Set([...document.querySelectorAll('.resource-item')]
      .filter((card) => !card.closest('[hidden]')).map((card) => card.dataset.resourceId))];
  })()`);
  assert.deepEqual(filtered, ['canvas']);
  const favoriteFilter = await window.webContents.executeJavaScript(`(() => {
    document.getElementById('workspaceSearch').value = '';
    document.getElementById('workspaceSearch').dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.filter-button')].find((button) => button.textContent === '已收藏').click();
    return [...new Set([...document.querySelectorAll('.resource-item')]
      .filter((card) => !card.closest('[hidden]')).map((card) => card.dataset.resourceId))];
  })()`);
  assert.deepEqual(favoriteFilter.sort(), ['canvas', 'hpc', 'library', 'outlook']);
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('.resource-star').click();
    document.getElementById('officialLaunch').click();
    document.getElementById('manageRules').click();
    document.getElementById('createGroup').click();
    document.getElementById('groupName').value = '科研';
    document.getElementById('saveGroup').click();
    document.getElementById('toggleManage').click();
    [...document.querySelectorAll('.filter-button')]
      .find((button) => button.textContent === '全部').click();
    const select = document.querySelector('.resource-group-select');
    select.value = 'group_abcdefghijkl';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const dragData = new DataTransfer();
    const discovered = document.querySelector('[data-resource-id="class-schedule"]');
    const targetGroup = document.querySelector('[data-group-id="group_abcdefghijkl"]');
    discovered.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dragData }));
    targetGroup.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dragData }));
    targetGroup.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dragData }));
    discovered.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dragData }));
    const custom = document.querySelector('[data-resource-id="hpc"]');
    custom.querySelector('.resource-rename').click();
    document.getElementById('groupName').value = '科研服务器';
    document.getElementById('saveGroup').click();
    custom.querySelector('.resource-delete').click();
    custom.querySelector('.resource-delete').click();
  })()`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(commands.some(({ command }) => command === 'toggle-favorite'), true);
  assert.equal(commands.some(({ command, resourceId }) =>
    command === 'open-resource' && resourceId === 'official-portal'), true);
  assert.equal(commands.some(({ command }) => command === 'manage-rules'), true);
  assert.equal(commands.some(({ command, name }) => command === 'create-group' && name === '科研'), true);
  assert.equal(commands.some(({ command }) => command === 'move-resource'), true);
  assert.equal(commands.some(({ command, resourceId, groupId }) =>
    command === 'move-resource' && resourceId === 'class-schedule' &&
    groupId === 'group_abcdefghijkl'), true);
  assert.equal(commands.some(({ command, resourceId, name }) =>
    command === 'rename-resource' && resourceId === 'hpc' && name === '科研服务器'), true);
  assert.equal(commands.some(({ command, resourceId }) =>
    command === 'delete-resource' && resourceId === 'hpc'), true);
  await capture(window, 'manage');
  window.destroy();
  process.stdout.write('campus workspace layout: PASS\n');
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
