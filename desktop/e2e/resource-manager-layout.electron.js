'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
        actions: rect(dialog.querySelector('.dialog-actions')),
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
    resourceId: 'custom-test-2',
  }, 'adding and opening did not use the saved WebResource ID');
}

async function exerciseIntegrationCenter(window) {
  window.setContentSize(500, 640);
  await waitFor(window, 'window.innerWidth === 500 && window.innerHeight === 640', 'compact Integration Center size');
  await window.webContents.executeJavaScript(`document.querySelector('.nav[data-page="tower"]').click()`);
  await waitFor(window,
    `document.querySelectorAll('[data-integration-adapter]').length === 2`,
    'Integration Center rows');
  const capabilities = await window.webContents.executeJavaScript(`(async () => {
    const state = await window.api.getState();
    return {
      hidden: document.getElementById('capabilitySummary').hidden,
      rows: document.querySelectorAll('.capability-item').length,
      text: document.getElementById('capabilitySummary').textContent,
      feature: !!window.capabilityPresentationFeature,
      view: window.capabilityPresentation?.capabilityView(state.capabilitySnapshot) || null,
    };
  })()`);
  assert.equal(capabilities.hidden, false,
    `confirmed capabilities stayed hidden: ${JSON.stringify(capabilities)}`);
  assert.equal(capabilities.rows, 5, 'CapabilitySnapshot did not render the bounded summary');
  assert.match(capabilities.text, /密码登录|Password sign-in/u);
  assert.doesNotMatch(capabilities.text, /auth\.password|accountHandle/u,
    'Control Tower exposed raw capability or Account fields');
  const explanation = await window.webContents.executeJavaScript(`(() => {
    const details = document.querySelector('.integration-explainer');
    details.querySelector('summary').click();
    return { open: details.open, text: details.textContent };
  })()`);
  assert.equal(explanation.open, true, 'Integration Center explanation did not expand');
  assert.match(explanation.text, /SOCKS5/u,
    'Integration Center explanation omitted its local proxy mechanism');
  assert.match(explanation.text, /校园账号密码|campus password/iu,
    'Integration Center explanation omitted the credential boundary');
  const prepared = await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-integration-adapter="clash_mihomo_yaml"] [data-integration-action="copy"]').click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const dialog = document.getElementById('integrationDialog');
    const rect = dialog.getBoundingClientRect();
    return {
      open: dialog.open,
      rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
      summary: document.getElementById('integrationPreviewSummary').textContent,
      warning: document.getElementById('integrationPreviewWarnings').textContent,
      pageText: document.body.textContent,
    };
  })()`);
  assert.equal(prepared.open, true, 'Integration Center preview did not open');
  assert.ok(prepared.rect.top >= 48 && prepared.rect.left >= 8,
    'Integration Center preview overlaps the titlebar or window edge');
  assert.ok(prepared.rect.right <= 500 - 8 && prepared.rect.bottom <= 640 - 12,
    'Integration Center preview escapes the compact viewport');
  assert.match(prepared.summary, /1|512|2/u, 'Integration Center omitted the bounded change summary');
  assert.match(prepared.warning, /凭据|credential/iu,
    'Integration Center omitted the local proxy credential warning');
  assert.doesNotMatch(prepared.pageText, /\/Users\/|\\Users\\|password\s*[:=]/iu,
    'Integration Center exposed a path or credential value to the renderer');

  await window.webContents.executeJavaScript(`document.getElementById('confirmIntegration').click()`);
  await waitFor(window, `document.getElementById('integrationDialog').open === false`,
    'configuration export confirmation');
  const confirmed = await window.webContents.executeJavaScript(`({
    dialogOpen: document.getElementById('integrationDialog').open,
    status: document.getElementById('integrationStatus').textContent,
    adapterCount: document.querySelectorAll('[data-integration-adapter]').length,
    installVisible: !!document.querySelector('[data-integration-action="install"], [data-integration-action="update"], [data-integration-action="remove"]'),
    vscodeSaveVisible: !!document.querySelector('[data-integration-adapter="vscode_remote_ssh"] [data-integration-action="save"]'),
  })`);
  assert.equal(confirmed.dialogOpen, false, 'confirmed Integration Center preview remained open');
  assert.ok(confirmed.status, 'confirmed Integration Center operation gave no visible result');
  assert.equal(confirmed.adapterCount, 2, 'production Integration Center exposed a historical adapter');
  assert.equal(confirmed.installVisible, false, 'Integration Center exposed third-party installation controls');
  assert.equal(confirmed.vscodeSaveVisible, false, 'VS Code snippet must remain copy-only');
}

async function exerciseBuiltinResourceRemoval(window) {
  const result = await window.webContents.executeJavaScript(`(async () => {
    const dialog = document.getElementById('resourceDialog');
    if (!dialog.open) document.getElementById('manageResources').click();
    document.querySelector('[data-resource-id="builtin-home"] [data-resource-action="delete"]').click();
    document.querySelector('[data-resource-id="builtin-home"] [data-resource-action="delete"]').click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const removed = !document.querySelector('[data-resource-id="builtin-home"]');
    document.getElementById('restoreBuiltinResources').click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      removed,
      restored: !!document.querySelector('[data-resource-id="builtin-home"]'),
      error: document.getElementById('resourceFormError').textContent,
    };
  })()`);
  assert.equal(result.removed, true, 'built-in website did not disappear after confirmation');
  assert.equal(result.restored, true, 'restore did not return the built-in website');
  assert.equal(result.error, '', 'built-in remove/restore reported an error');
}

async function assertStudentHome(window) {
  for (const [width, expectedColumns] of [[420, 2], [960, 3]]) {
    window.setContentSize(width, 720);
    await waitFor(window, `window.innerWidth === ${width}`, `Student Home ${width}px width`);
    const view = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.nav[data-page="connect"]').click();
      const grid = document.querySelector('.resource-section .resource-grid');
      const hero = document.getElementById('connTop').getBoundingClientRect();
      const search = document.getElementById('resourceSearch').getBoundingClientRect();
      const manual = document.querySelector('.custom-url-details').getBoundingClientRect();
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      const content = document.querySelector('.content');
      content.scrollTop = content.scrollHeight;
      document.querySelector('.nav[data-page="settings"]').click();
      return {
        columns,
        heroHeight: hero.height,
        resourceSections: document.querySelectorAll('.resource-section').length,
        searchBeforeManual: search.top < manual.top,
        towerHidden: document.querySelector('.nav[data-page="tower"]').hidden,
        diagnosticsClosed: !document.querySelector('.diagnostic-details').open,
        scrollTopAfterPageSwitch: content.scrollTop,
      };
    })()`);
    assert.equal(view.columns, expectedColumns, `${width}px: resource grid column count`);
    assert.ok(view.heroHeight >= 82 && view.heroHeight <= 120,
      `${width}px: connection header is not compact and balanced`);
    assert.ok(view.resourceSections >= 1, `${width}px: resource-first sections are absent`);
    assert.equal(view.searchBeforeManual, true, `${width}px: manual URL still precedes resource search`);
    assert.equal(view.towerHidden, false, `${width}px: Control Tower navigation disappeared`);
    assert.equal(view.diagnosticsClosed, true, `${width}px: raw diagnostics are expanded by default`);
    assert.equal(view.scrollTopAfterPageSwitch, 0, `${width}px: page switch retained stale scroll`);
  }
}

async function assertTwoHundredPercentReflow(window) {
  window.setContentSize(620, 720);
  window.webContents.setZoomFactor(2);
  await new Promise((resolve) => setTimeout(resolve, 80));
  try {
    for (const page of ['connect', 'tower', 'notif', 'settings']) {
      const view = await window.webContents.executeJavaScript(`(() => {
        document.querySelector('.nav[data-page="${page}"]').click();
        const viewport = document.documentElement.clientWidth;
        const active = document.querySelector('.page.active').getBoundingClientRect();
        const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
        return {
          page: '${page}',
          viewport,
          scrollWidth: document.documentElement.scrollWidth,
          activeLeft: active.left,
          activeRight: active.right,
          sidebarLeft: sidebar.left,
          sidebarRight: sidebar.right,
        };
      })()`);
      assert.ok(view.viewport > 0, `${page}: 200% viewport is unavailable`);
      assert.ok(view.scrollWidth <= view.viewport + 1,
        `${page}: 200% zoom introduced horizontal page overflow`);
      assert.ok(view.sidebarLeft >= 0 && view.sidebarRight <= view.viewport,
        `${page}: 200% zoom clipped the navigation`);
      assert.ok(view.activeLeft >= view.sidebarRight - 1 && view.activeRight <= view.viewport + 1,
        `${page}: 200% zoom clipped the active page`);
    }
  } finally {
    window.webContents.setZoomFactor(1);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function captureVisualStates(window) {
  const output = process.env.HKUSTGZ_LAYOUT_SCREENSHOT_DIR;
  if (!output) return;
  if (!path.isAbsolute(output)) throw new Error('layout screenshot directory must be absolute');
  fs.mkdirSync(output, { recursive: true });
  for (const [label, width, height] of [
    ['compact', 420, 720],
    ['standard', 620, 760],
    ['wide', 960, 760],
  ]) {
    window.setContentSize(width, height);
    await waitFor(window, `window.innerWidth === ${width}`, `${label} screenshot width`);
    for (const page of ['connect', 'tower', 'notif', 'settings']) {
      await window.webContents.executeJavaScript(`(() => {
        for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
        document.querySelector('.nav[data-page="${page}"]').click();
        document.querySelector('.content').scrollTop = 0;
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(
          () => setTimeout(resolve, 260),
        )));
      })()`);
      const image = await window.webContents.capturePage();
      fs.writeFileSync(path.join(output, `${label}-${page}.png`), image.toPNG());
    }
  }
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
    await assertStudentHome(window);
    await assertTwoHundredPercentReflow(window);
    await exerciseIntegrationCenter(window);
    for (const [width, height] of [[500, 640], [420, 560], [760, 900]]) {
      assertLayout(await measureAt(window, width, height), width, height);
    }
    assertCustomResourceSave(await saveCustomResource(window));
    assertCustomResourceAddAndOpen(await addAndOpenCustomResource(window));
    await exerciseBuiltinResourceRemoval(window);
    await captureVisualStates(window);
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
