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
    const groupGrid = document.querySelector('#favoriteGroups .resource-grid');
    const groupColumns = groupGrid
      ? getComputedStyle(groupGrid).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    const groupContainer = document.getElementById('favoriteGroups');
    const groupModules = getComputedStyle(groupContainer).gridTemplateColumns
      .split(' ').filter(Boolean).length;
    return {
      width: innerWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      navigation: [...document.querySelectorAll('[data-workspace-screen]')]
        .map((button) => button.textContent.trim()),
      gateways: document.querySelectorAll('.gateway-button').length,
      groupColumns,
      groupModules,
      hasSearch: !!document.getElementById('workspaceSearch'),
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

  for (const [label, width, height, minimumFavoriteColumns, minimumCategoryColumns] of [
    ['compact', 660, 560, 2, 1],
    ['standard', 1040, 740, 3, 2],
    ['wide', 1400, 900, 4, 3],
  ]) {
    window.setContentSize(width, height);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const home = await inspect(window);
    assert.equal(home.width, width);
    assert.equal(home.noHorizontalOverflow, true, `${label} overflowed horizontally`);
    assert.deepEqual(home.navigation, ['校园服务', '整理收藏']);
    assert.equal(home.gateways, 3);
    assert.equal(home.hasSearch, true);
    assert.ok(home.groupColumns * home.groupModules >= minimumFavoriteColumns,
      `${label} favorites did not use available width`);
    await capture(window, `${label}-home`);

    const categoryColumns = await window.webContents.executeJavaScript(
      `Number.parseInt(getComputedStyle(document.getElementById('categorySections')).columnCount, 10)`,
    );
    assert.ok(categoryColumns >= minimumCategoryColumns, `${label} catalogue is too sparse`);
    await capture(window, `${label}-services`);
  }

  const courses = await window.webContents.executeJavaScript(`(() => {
    const section = document.getElementById('service-category-courses');
    section.querySelector('[data-resource-id="sis"] .resource-open').click();
    return {
      ids: [...section.querySelectorAll('.resource-item')]
        .map((item) => item.dataset.resourceId),
      serviceScreenVisible: !document.getElementById('homeScreen').hidden,
      categoryJumpCount: document.querySelectorAll('.category-jump').length,
    };
  })()`);
  assert.equal(courses.ids.includes('sis'), true);
  assert.equal(courses.ids.includes('canvas'), true);
  assert.equal(courses.ids.includes('new-student'), false);
  assert.equal(courses.serviceScreenVisible, true);
  assert.ok(courses.categoryJumpCount >= 10);

  const leaveSearch = await window.webContents.executeJavaScript(`(() => {
    const search = document.getElementById('workspaceSearch');
    search.value = '请假';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const ids = [...document.querySelectorAll('#searchGrid .resource-item')]
      .map((item) => item.dataset.resourceId).sort();
    document.getElementById('clearWorkspaceSearch').click();
    return ids;
  })()`);
  assert.deepEqual(leaveSearch, ['e-form', 'student-request-guide']);

  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-workspace-screen="manage"]').click();
    document.querySelector('#resourcePool .resource-star').click();
    document.querySelector('.gateway-button').click();
    document.getElementById('manageRules').click();
    document.getElementById('createGroup').click();
    document.getElementById('groupName').value = '科研';
    document.getElementById('saveGroup').click();
    const select = document.querySelector('#resourcePool .resource-group-select');
    select.value = 'group_abcdefghijkl';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const dragData = new DataTransfer();
    const discovered = document.querySelector('#resourcePool [data-resource-id="class-schedule"]');
    const targetGroup = document.querySelector('#manageGroups [data-group-id="group_abcdefghijkl"]');
    discovered.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dragData }));
    targetGroup.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dragData }));
    targetGroup.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dragData }));
    discovered.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dragData }));
    const custom = document.querySelector('#resourcePool [data-resource-id="hpc"]');
    custom.querySelector('.resource-rename').click();
    document.getElementById('groupName').value = '科研服务器';
    document.getElementById('saveGroup').click();
    custom.querySelector('.resource-delete').click();
    custom.querySelector('.resource-delete').click();
  })()`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(commands.some(({ command }) => command === 'toggle-favorite'), true);
  assert.equal(commands.some(({ command, resourceId }) =>
    command === 'open-resource' && resourceId === 'sis'), true);
  assert.equal(commands.some(({ command, resourceId }) =>
    command === 'open-resource' && resourceId === 'official-portal'), true);
  assert.equal(commands.some(({ command }) => command === 'manage-rules'), true);
  assert.equal(commands.some(({ command, name }) => command === 'create-group' && name === '科研'), true);
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
