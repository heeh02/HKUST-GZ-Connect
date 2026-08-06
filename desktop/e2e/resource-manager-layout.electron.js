'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const renderer = path.join(__dirname, '..', 'renderer', 'index.html');
const preload = path.join(__dirname, 'resource-manager-layout-preload.js');

async function waitFor(window, expression, description) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function measureAt(window, width, height) {
  window.setContentSize(width, height);
  await waitFor(window, `window.innerWidth === ${width} && window.innerHeight === ${height}`, `${width}×${height} content size`);

  return window.webContents.executeJavaScript(`(() => {
    const dialog = document.getElementById('resourceDialog');
    if (dialog.open) dialog.close();
    document.getElementById('manageResources').click();
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector('[data-resource-action="edit"]').click();
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height };
      };
      const body = document.querySelector('.resource-dialog-body');
      const list = document.getElementById('resourceEditorList');
      const row = document.querySelector('.resource-editor-row');
      const rowActions = document.querySelector('.resource-editor-actions');
      resolve({
        open: dialog.open,
        dialog: rect(dialog),
        close: rect(document.getElementById('closeResourceDialog')),
        actions: rect(document.querySelector('.dialog-actions')),
        body: body && {
          ...rect(body),
          clientHeight: body.clientHeight,
          scrollHeight: body.scrollHeight,
          overflowY: getComputedStyle(body).overflowY,
        },
        list: { ...rect(list), clientHeight: list.clientHeight, scrollHeight: list.scrollHeight },
        row: rect(row),
        rowActions: rowActions && rect(rowActions),
        selectedName: document.getElementById('resourceName').value,
        activeRows: document.querySelectorAll('.resource-editor-row.active').length,
      });
    })));
  })()`);
}

function assertLayout(view, width, height) {
  const label = `${width}×${height}`;
  assert.equal(view.open, true, `${label}: manager did not open`);
  assert.ok(view.body, `${label}: manager has no independently scrollable body`);
  assert.ok(view.rowActions, `${label}: resource controls do not have a compact action region`);
  assert.equal(view.selectedName, '测试网站 1', `${label}: compact action region no longer opens the selected shortcut`);
  assert.equal(view.activeRows, 1, `${label}: selected shortcut no longer receives its active state`);
  assert.ok(view.dialog.top >= 48, `${label}: manager overlaps the titlebar safe area`);
  assert.ok(view.dialog.left >= 12 && view.dialog.right <= width - 12, `${label}: manager escapes horizontal safe area`);
  assert.ok(view.dialog.width <= 540, `${label}: manager grows beyond its readable maximum width`);
  assert.ok(Math.abs((view.dialog.left + view.dialog.right) / 2 - width / 2) <= 1, `${label}: manager is not horizontally centered`);
  assert.ok(view.close.top >= view.dialog.top && view.close.right <= view.dialog.right, `${label}: close control is clipped`);
  assert.ok(view.actions.bottom <= view.dialog.bottom, `${label}: action bar is outside the manager`);
  assert.ok(view.body.top >= view.dialog.top && view.body.bottom <= view.actions.top, `${label}: body crosses fixed dialog regions`);
  assert.equal(view.body.overflowY, 'auto', `${label}: only the dialog body must own page-length scrolling`);
  assert.ok(view.body.clientHeight > 0, `${label}: dialog body has no visible scroll region`);
  assert.ok(view.list.clientHeight > 0 && view.list.scrollHeight > view.list.clientHeight, `${label}: long resource list is not bounded`);
  assert.ok(view.row.right <= view.dialog.right && view.rowActions.right <= view.dialog.right, `${label}: resource controls overflow the manager`);
}

async function saveCustomResource(window) {
  return window.webContents.executeJavaScript(`(async () => {
    const dialog = document.getElementById('resourceDialog');
    if (!dialog.open) document.getElementById('manageResources').click();
    document.getElementById('cancelResource').click();
    document.getElementById('resourceName').value = '';
    const url = document.getElementById('resourceUrl');
    url.value = 'research.example.edu:4433';
    url.dispatchEvent(new Event('blur'));
    document.getElementById('resourceDescription').value = '测试自定义网站保存';
    document.getElementById('resourceRoute').value = 'campus';
    const generatedName = document.getElementById('resourceName').value;
    document.getElementById('resourceForm').requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const row = [...document.querySelectorAll('.resource-editor-row')]
      .find((candidate) => candidate.textContent.includes('research.example.edu:4433'));
    return {
      error: document.getElementById('resourceFormError').textContent,
      generatedName,
      rowText: row?.textContent || '',
      urlCleared: document.getElementById('resourceUrl').value === '',
      customRows: [...document.querySelectorAll('.resource-editor-row')]
        .filter((candidate) => candidate.textContent.includes('research.example.edu:4433')).length,
      savedMessage: document.getElementById('resourceSaved')?.textContent || '',
      formSavedMessage: document.getElementById('resourceFormSaved')?.textContent || '',
    };
  })()`);
}

function assertCustomResourceSave(result) {
  assert.equal(result.error, '', 'saving a custom website reported an error');
  assert.equal(result.generatedName, 'research.example.edu:4433', 'a URL-only shortcut did not receive a useful default name');
  assert.match(result.rowText, /research\.example\.edu:4433/, 'saved custom website is absent from the manager');
  assert.equal(result.urlCleared, true, 'the editor did not return to a clean new-resource state');
  assert.equal(result.customRows, 1, 'saved custom website was duplicated in the manager');
  assert.equal(result.savedMessage, '已添加到常用网站', 'saving a shortcut did not give a positive confirmation');
  assert.equal(result.formSavedMessage, '已添加到常用网站', 'the manager did not visibly confirm a saved shortcut');
}

async function addAndOpenCustomResource(window) {
  return window.webContents.executeJavaScript(`(async () => {
    const dialog = document.getElementById('resourceDialog');
    if (dialog.open) dialog.close();
    const add = document.getElementById('quickAddCampus');
    if (!add) return { controlPresent: false };
    document.getElementById('campusUrl').value = '103.189.154.10:4433';
    add.click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      controlPresent: true,
      error: document.getElementById('quickAddErr')?.textContent || '',
      savedMessage: document.getElementById('resourceSaved')?.textContent || '',
      openedRequest: window.api.testState().lastOpenRequest,
      savedRows: [...document.querySelectorAll('.resource-editor-row')]
        .filter((candidate) => candidate.textContent.includes('103.189.154.10:4433')).length,
    };
  })()`);
}

function assertCustomResourceAddAndOpen(result) {
  assert.equal(result.controlPresent, true, 'dashboard is missing the add-to-favorites action');
  assert.equal(result.error, '', 'adding and opening a shortcut reported an error');
  assert.equal(result.savedMessage, '已添加到常用网站', 'adding and opening did not confirm the saved shortcut');
  assert.equal(result.savedRows, 1, 'adding and opening did not persist a shortcut');
  assert.deepEqual(result.openedRequest, {
    url: 'https://103.189.154.10:4433/',
    route: 'campus',
  }, 'adding and opening did not use the saved campus route');
}

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 500,
    height: 640,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload },
  });

  try {
    await window.loadFile(renderer);
    await waitFor(window, "document.getElementById('dash').hidden === false", 'dashboard initialization');
    for (const [width, height] of [[500, 640], [420, 560], [760, 900]]) {
      assertLayout(await measureAt(window, width, height), width, height);
    }
    assertCustomResourceSave(await saveCustomResource(window));
    assertCustomResourceAddAndOpen(await addAndOpenCustomResource(window));
    process.stdout.write('resource manager layout: PASS\n');
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

main().then(
  () => app.quit(),
  (error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  },
);
