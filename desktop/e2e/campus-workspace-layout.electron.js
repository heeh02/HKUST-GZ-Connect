'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { CampusWorkspaceController } = require('../lib/browser/workspace/campus-workspace-controller');

const resources = Object.freeze([
  ['official-portal', 'myPortal 官方门户', 'common', 'campus', false, null],
  ['canvas', 'Canvas 教学平台', 'academic', 'direct', true, 900],
  ['library', '图书馆', 'academic', 'campus', true, 800],
  ['hpc', 'HPC 登录入口', 'custom', 'campus', true, 700],
  ['outlook', 'Outlook 邮箱', 'common', 'direct', true, 600],
  ['sis', '学生信息系统 SIS', 'academic', 'campus', false, 500],
  ['schedule', '课表与课程容量', 'academic', 'campus', false, 400],
  ['booking', '教室预约系统', 'campus-service', 'campus', false, 300],
  ['forms', 'E-form System', 'campus-service', 'campus', false, null],
  ['home', '学校主页', 'campus-service', 'campus', false, null],
].map(([id, name, category, route, favorite, lastOpenedAt]) => Object.freeze({
  id, name, description: `${name} fixture`, url: `https://${id}.example.edu/`,
  category, route, favorite, lastOpenedAt,
})));

async function inspect(window) {
  return window.webContents.executeJavaScript(`(() => {
    const grid = document.getElementById('servicesGrid');
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    const groupGrid = document.querySelector('.favorite-group .resource-grid');
    const groupColumns = groupGrid
      ? getComputedStyle(groupGrid).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    const groupContainer = document.getElementById('favoriteGroups');
    const groupModules = getComputedStyle(groupContainer).gridTemplateColumns
      .split(' ').filter(Boolean).length;
    return {
      width: innerWidth,
      columns,
      groupColumns,
      groupModules,
      cards: new Set([...document.querySelectorAll('.resource-item')].map((card) => card.dataset.resourceId)).size,
      visibleCards: [...document.querySelectorAll('.resource-item')].filter((card) => !card.hidden).length,
      hasSearch: !!document.getElementById('workspaceSearch'),
      chipLabels: [...document.querySelectorAll('.filter-button')].map((button) => button.textContent.trim()),
      officialVisible: !document.getElementById('officialModule').hidden,
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
    assert.equal(state.cards, resources.length);
    assert.equal(state.hasSearch, true);
    assert.equal(state.officialVisible, true);
    assert.ok(state.columns >= minimumColumns, `${label} did not use available width`);
    assert.ok(state.groupColumns * state.groupModules >= minimumColumns,
      `${label} group layout did not use available width`);
    await capture(window, label);
  }

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
    document.getElementById('manageRules').click();
    document.getElementById('createGroup').click();
    document.getElementById('groupName').value = '科研';
    document.getElementById('saveGroup').click();
    document.getElementById('toggleManage').click();
    const select = document.querySelector('.resource-group-select');
    select.value = 'group_abcdefghijkl';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(commands.some(({ command }) => command === 'toggle-favorite'), true);
  assert.equal(commands.some(({ command }) => command === 'manage-rules'), true);
  assert.equal(commands.some(({ command, name }) => command === 'create-group' && name === '科研'), true);
  assert.equal(commands.some(({ command }) => command === 'move-resource'), true);
  window.destroy();
  process.stdout.write('campus workspace layout: PASS\n');
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
