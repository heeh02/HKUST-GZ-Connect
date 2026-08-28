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
    const grid = document.getElementById('serviceViewGrid');
    const gridRect = grid.getBoundingClientRect();
    const itemRects = [...grid.querySelectorAll('.resource-item')]
      .map((item) => item.getBoundingClientRect());
    return {
      width: innerWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      noVerticalPageScroll: document.documentElement.scrollHeight <= innerHeight,
      duplicateHeader: document.querySelectorAll('.workspace-header').length,
      duplicateSearch: document.querySelectorAll('#workspaceSearch').length,
      gridColumns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      visibleResources: grid.querySelectorAll('.resource-item').length,
      everyResourceFits: itemRects.every((rect) =>
        rect.top >= gridRect.top - 1 && rect.bottom <= gridRect.bottom + 1),
      primaryTabs: document.querySelectorAll('[data-primary-view]').length,
      secondaryTabs: document.querySelectorAll('.secondary-tab').length,
      secondarySelectVisible: getComputedStyle(document.getElementById('secondarySelect')).display !== 'none',
      secondaryTabsVisible: getComputedStyle(document.getElementById('serviceViewTabs')).display !== 'none',
      pagerRange: document.querySelector('.pager-range')?.textContent || '',
      pagerButtons: document.querySelectorAll('.pager-button').length,
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
  const catalogueSize = resources.filter(({ category }) => category !== 'gateway').length;

  for (const [label, width, height, expectedColumns, expectedItems, usesSelect] of [
    ['compact', 660, 720, 1, 6, true],
    ['standard', 1040, 740, 2, 8, false],
    ['wide', 1400, 900, 3, 12, false],
  ]) {
    window.setContentSize(width, height);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await window.webContents.executeJavaScript(`(() => new Promise((resolve) => {
      document.getElementById('primaryCatalog').click();
      [...document.querySelectorAll('.secondary-tab')]
        .find((button) => button.textContent.startsWith('全部 ')).click();
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }))()`);
    const home = await inspect(window);
    assert.equal(home.width, width);
    assert.equal(home.noHorizontalOverflow, true, `${label} overflowed horizontally`);
    assert.equal(home.noVerticalPageScroll, true, `${label} requires whole-page scrolling`);
    assert.equal(home.duplicateHeader, 0, `${label} repeats the browser Profile header`);
    assert.equal(home.duplicateSearch, 0, `${label} repeats the browser address search`);
    assert.equal(home.gridColumns, expectedColumns, `${label} service grid columns`);
    assert.equal(home.visibleResources, expectedItems, `${label} page capacity is unstable`);
    assert.equal(home.everyResourceFits, true, `${label} clips a resource row`);
    assert.equal(home.primaryTabs, 3, `${label} primary product modes are incomplete`);
    assert.ok(home.secondaryTabs >= 10, `${label} catalogue categories are incomplete`);
    assert.equal(home.secondarySelectVisible, usesSelect, `${label} secondary navigation mode is wrong`);
    assert.equal(home.secondaryTabsVisible, !usesSelect, `${label} secondary tabs visibility is wrong`);
    assert.match(home.pagerRange, new RegExp(`1[–-]${expectedItems} / ${catalogueSize}`, 'u'));
    assert.equal(home.pagerButtons, 2, `${label} explicit pagination controls are missing`);
    await capture(window, `${label}-home`);
    await capture(window, `${label}-services`);
  }

  window.setContentSize(1040, 900);
  window.webContents.setZoomFactor(1.25);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const zoomed = await inspect(window);
  assert.equal(zoomed.noHorizontalOverflow, true, '125% zoom overflowed horizontally');
  assert.equal(zoomed.noVerticalPageScroll, true, '125% zoom requires whole-page scrolling');
  assert.equal(zoomed.everyResourceFits, true, '125% zoom clips a resource row');
  await capture(window, 'zoomed-services');
  window.webContents.setZoomFactor(2);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const zoomed200 = await inspect(window);
  assert.equal(zoomed200.noHorizontalOverflow, true, '200% zoom overflowed horizontally');
  assert.equal(zoomed200.primaryTabs, 3, '200% zoom hides a primary product mode');
  assert.equal(zoomed200.pagerButtons, 2, '200% zoom hides explicit pagination');
  window.webContents.setZoomFactor(1);
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(controller.focus(window.webContents, 'search', '请假'), true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const addressSearch = await window.webContents.executeJavaScript(`({
    title: document.getElementById('searchTitle').textContent,
    ids: [...document.querySelectorAll('#searchGrid .resource-item')]
      .map((item) => item.dataset.resourceId).sort(),
  })`);
  assert.match(addressSearch.title, /请假/u);
  assert.deepEqual(addressSearch.ids, ['e-form', 'student-request-guide']);
  assert.equal(controller.focus(window.webContents, 'search', '学习'), true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const groupSearch = await window.webContents.executeJavaScript(`({
    title: document.getElementById('serviceViewTitle').textContent,
    homeVisible: !document.getElementById('homeScreen').hidden,
    activePrimary: document.querySelector('[data-primary-view].active')?.dataset.primaryView,
  })`);
  assert.deepEqual(groupSearch, { title: '学习', homeVisible: true, activePrimary: 'workspace' });
  const recentView = await window.webContents.executeJavaScript(`(() => {
    document.getElementById('primaryRecent').click();
    return {
      count: document.querySelectorAll('#serviceViewGrid .resource-item').length,
      timestamps: [...document.querySelectorAll('#serviceViewGrid .resource-last-opened')]
        .map((item) => item.textContent),
    };
  })()`);
  assert.ok(recentView.count > 0);
  assert.equal(recentView.timestamps.length, recentView.count,
    'recent resources do not show their opened time');
  assert.equal(recentView.timestamps.every((value) => value.includes('打开于')), true);

  const courses = await window.webContents.executeJavaScript(`(() => {
    document.getElementById('primaryCatalog').click();
    [...document.querySelectorAll('.secondary-tab')]
      .find((button) => button.textContent.includes('课程与考试')).click();
    const grid = document.getElementById('serviceViewGrid');
    grid.querySelector('[data-resource-id="sis"] .resource-open').click();
    return {
      ids: [...grid.querySelectorAll('.resource-item')]
        .map((item) => item.dataset.resourceId),
      serviceScreenVisible: !document.getElementById('homeScreen').hidden,
      selectedCategory: document.querySelector('.secondary-tab.active')?.textContent,
    };
  })()`);
  assert.equal(courses.ids.includes('sis'), true);
  assert.equal(courses.ids.includes('canvas'), true);
  assert.equal(courses.ids.includes('new-student'), false);
  assert.equal(courses.serviceScreenVisible, true);
  assert.match(courses.selectedCategory, /课程与考试/u);

  assert.equal(controller.focus(window.webContents, 'search', '请假'), true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const leaveSearch = await window.webContents.executeJavaScript(`(() => {
    const ids = [...document.querySelectorAll('#searchGrid .resource-item')]
      .map((item) => item.dataset.resourceId).sort();
    document.getElementById('clearWorkspaceSearch').click();
    return ids;
  })()`);
  assert.deepEqual(leaveSearch, ['e-form', 'student-request-guide']);

  const managementView = await window.webContents.executeJavaScript(`(() => {
    document.getElementById('openManage').click();
    document.querySelector('#manageFolderNav [data-folder-id="all"] .manage-folder-select').click();
    document.querySelector('#resourcePool .resource-star').click();
    document.getElementById('createGroup').click();
    document.getElementById('groupName').value = '科研';
    document.getElementById('saveGroup').click();
    document.querySelector('#resourcePool .resource-selection input').click();
    const bulkGroup = document.getElementById('bulkGroupSelect');
    bulkGroup.value = 'group_abcdefghijkl';
    bulkGroup.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('bulkAddToGroup').click();
    const dragData = new DataTransfer();
    const discovered = document.querySelector('#resourcePool [data-resource-id="class-schedule"]');
    const targetGroup = document.querySelector('#manageFolderNav [data-folder-id="group_abcdefghijkl"]');
    discovered.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dragData }));
    targetGroup.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dragData }));
    targetGroup.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dragData }));
    discovered.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dragData }));
    while (!document.querySelector('#managePager .pager-button:last-child')?.disabled) {
      document.querySelector('#managePager .pager-button:last-child').click();
    }
    const custom = document.querySelector('#resourcePool [data-resource-id="hpc"]');
    custom.querySelector('.resource-rename').click();
    document.getElementById('groupName').value = '科研服务器';
    document.getElementById('saveGroup').click();
    custom.querySelector('.resource-delete').click();
    custom.querySelector('.resource-delete').click();
    return {
      visible: !document.getElementById('manageScreen').hidden,
      bulkVisible: getComputedStyle(document.getElementById('bulkActions')).display !== 'none',
      rowCheckboxes: document.querySelectorAll('#resourcePool .resource-selection input').length,
      perRowGroupSelects: document.querySelectorAll('#resourcePool .resource-group-select').length,
    };
  })()`);
  assert.equal(managementView.visible, true, 'organizer stopped being the active workspace screen');
  assert.equal(managementView.bulkVisible, true, 'batch organizer controls are hidden');
  assert.ok(managementView.rowCheckboxes > 0, 'organizer rows have no batch selection control');
  assert.equal(managementView.perRowGroupSelects, 0, 'per-row group dropdowns returned');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(commands.some(({ command }) => command === 'toggle-favorite'), true);
  assert.equal(commands.some(({ command, resourceId }) =>
    command === 'open-resource' && resourceId === 'sis'), true);
  assert.equal(commands.some(({ command, name }) => command === 'create-group' && name === '科研'), true);
  assert.equal(commands.some(({ command, resourceIds, groupId }) =>
    command === 'add-resources-to-group' && resourceIds.length === 1 &&
    groupId === 'group_abcdefghijkl'), true);
  assert.equal(commands.some(({ command, resourceIds, groupId }) =>
    command === 'add-resources-to-group' && resourceIds.includes('class-schedule') &&
    groupId === 'group_abcdefghijkl'), true,
  'dragging into a task workspace must preserve the resource other placements');
  assert.equal(commands.some(({ command, resourceId, name }) =>
    command === 'rename-resource' && resourceId === 'hpc' && name === '科研服务器'), true);
  assert.equal(commands.some(({ command, resourceId }) =>
    command === 'delete-resource' && resourceId === 'hpc'), true);
  await window.webContents.executeJavaScript(`(() => new Promise((resolve) => {
    document.getElementById('openManage').click();
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }))()`);
  await capture(window, 'manage');
  const returnedHome = await window.webContents.executeJavaScript(`(() => {
    document.getElementById('backToServices').click();
    return !document.getElementById('homeScreen').hidden && document.getElementById('manageScreen').hidden;
  })()`);
  assert.equal(returnedHome, true, 'organizer cannot return to Campus Services');
  window.destroy();
  process.stdout.write('campus workspace layout: PASS\n');
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
