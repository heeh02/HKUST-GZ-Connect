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
    document.getElementById('legacyResourceManager').click();
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
    if (!dialog.open) document.getElementById('legacyResourceManager').click();
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
  const capabilityBoundary = await window.webContents.executeJavaScript(`(async () => {
    const state = await window.api.getState();
    return {
      card: !!document.getElementById('capabilitySummary'),
      feature: !!window.capabilityPresentationFeature,
      projected: Object.hasOwn(state, 'capabilitySnapshot'),
    };
  })()`);
  assert.deepEqual(capabilityBoundary, { card: false, feature: false, projected: false },
    'Engine capability details must stay outside the Control Renderer');
  const routingStacks = await window.webContents.executeJavaScript(`(async () => {
    const accessibleGroups = () => [
      ...document.querySelectorAll('[data-routing-group]'),
      ...document.querySelectorAll('[data-routing-stack-activate]'),
    ].map((node) => node.dataset.routingGroup || node.dataset.routingStackActivate).sort();
    const initialGroup = document.querySelector('[data-routing-group]')?.dataset.routingGroup || '';
    const initialHost = document.querySelector('.routing-rule-row strong')?.textContent || '';
    document.querySelector('[data-routing-stack-activate]')?.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      groups: accessibleGroups(),
      initialGroup,
      initialHost,
      afterGroup: document.querySelector('[data-routing-group]')?.dataset.routingGroup || '',
      afterHost: document.querySelector('.routing-rule-row strong')?.textContent || '',
      legacyList: !!document.getElementById('routingRuleList'),
    };
  })()`);
  assert.deepEqual(routingStacks, {
    groups: ['campus', 'direct'],
    initialGroup: 'direct',
    initialHost: 'login.example.com',
    afterGroup: 'campus',
    afterHost: '',
    legacyList: false,
  }, 'routing stacks must lead with the populated route and keep the empty route accessible');
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
    if (!dialog.open) document.getElementById('legacyResourceManager').click();
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
  for (const [width, expectedMode, expectedColumns, expectedItems] of [
    [420, 'compact', 2, 10],
    [620, 'standard', 3, 10],
    [960, 'wide', 2, 10],
  ]) {
    window.setContentSize(width, 720);
    await waitFor(window, `window.innerWidth === ${width}`, `Student Home ${width}px width`);
    await window.webContents.executeJavaScript(
      `document.querySelector('.nav[data-page="connect"]').click()`,
    );
    await waitFor(window,
      `document.getElementById('resourceShelf').dataset.resourceLayout === '${expectedMode}'`,
      `Student Home ${width}px resource layout`);
    const view = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.nav[data-page="connect"]').click();
      const grid = document.querySelector('.resource-section .resource-grid');
      const hero = document.getElementById('connTop').getBoundingClientRect();
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      const firstItem = document.querySelector('.resource-card');
      const chips = document.getElementById('resourceViewChips');
      const select = document.getElementById('resourceView');
      const sectionColumns = getComputedStyle(document.getElementById('campusResources'))
        .gridTemplateColumns.split(' ').filter(Boolean).length;
      const controls = document.querySelector('.resource-library-controls');
      const content = document.querySelector('.content');
      const snapshot = {
        columns,
        layoutMode: document.getElementById('resourceShelf').dataset.resourceLayout,
        visibleItems: document.querySelectorAll('.resource-card').length,
        descriptions: document.querySelectorAll('.resource-desc, .resource-origin').length,
        firstDivider: getComputedStyle(firstItem).borderBottomStyle,
        chipsDisplay: getComputedStyle(chips).display,
        selectDisplay: getComputedStyle(select).display,
        controlsDisplay: getComputedStyle(controls).display,
        sectionColumns,
        heroHeight: hero.height,
        connectionActionText: document.getElementById('power').textContent.trim(),
        connectionActionHeight: document.getElementById('power').getBoundingClientRect().height,
        connectionActionWidth: document.getElementById('power').getBoundingClientRect().width,
        connectionActionRole: document.getElementById('power').getAttribute('role'),
        connectionActionChecked: document.getElementById('power').getAttribute('aria-checked'),
        legacySwitchKnobs: document.querySelectorAll('#power .knob').length,
        resourceSections: document.querySelectorAll('.resource-section').length,
        towerHidden: document.querySelector('.nav[data-page="tower"]').hidden,
        diagnosticsClosed: !document.querySelector('.diagnostic-details').open,
      };
      content.scrollTop = content.scrollHeight;
      document.querySelector('.nav[data-page="settings"]').click();
      snapshot.scrollTopAfterPageSwitch = content.scrollTop;
      return snapshot;
    })()`);
    assert.equal(view.columns, expectedColumns, `${width}px: resource grid column count`);
    assert.equal(view.layoutMode, expectedMode, `${width}px: resource layout mode`);
    assert.equal(view.visibleItems, expectedItems, `${width}px: responsive resource budget`);
    assert.equal(view.descriptions, 0, `${width}px: website explanation text returned`);
    assert.equal(view.firstDivider, 'solid', `${width}px: website divider disappeared`);
    assert.equal(view.controlsDisplay, 'none', `${width}px: delegated catalogue controls became visible`);
    assert.equal(view.chipsDisplay, 'none', `${width}px: duplicate category chips became visible`);
    assert.equal(view.selectDisplay, 'none', `${width}px: legacy category select became visible`);
    if (width >= 900) {
      assert.equal(view.sectionColumns, 2, `${width}px: wide resource modules`);
    }
    assert.ok(view.heroHeight >= 75 && view.heroHeight <= 105,
      `${width}px: connection status strip wastes vertical space`);
    assert.equal(view.connectionActionText, '连接', `${width}px: connection action is unclear`);
    assert.ok(view.connectionActionHeight >= 22 && view.connectionActionHeight <= 28,
      `${width}px: connection switch is not compact`);
    assert.ok(view.connectionActionWidth >= 40 && view.connectionActionWidth <= 48,
      `${width}px: connection switch is too wide`);
    assert.equal(view.connectionActionRole, 'switch', `${width}px: connection control lost switch semantics`);
    assert.equal(view.connectionActionChecked, 'false', `${width}px: disconnected switch state drifted`);
    assert.equal(view.legacySwitchKnobs, 0, `${width}px: ambiguous connection switch returned`);
    assert.ok(view.resourceSections >= 1, `${width}px: resource-first sections are absent`);
    assert.equal(view.towerHidden, false, `${width}px: Control Tower navigation disappeared`);
    assert.equal(view.diagnosticsClosed, true, `${width}px: raw diagnostics are expanded by default`);
    assert.equal(view.scrollTopAfterPageSwitch, 0, `${width}px: page switch retained stale scroll`);

    const workspaceEntry = await window.webContents.executeJavaScript(
      `document.getElementById('openCampusWorkspace').textContent.trim()`,
    );
    assert.match(workspaceEntry, /校园门户/u, `${width}px: Campus portal entry disappeared`);

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

async function assertUsabilityLayer(window) {
  window.setContentSize(500, 720);
  await waitFor(window, 'window.innerWidth === 500', 'usability fixture width');
  const result = await window.webContents.executeJavaScript(`(async () => {
    const key = (value, options = {}) => document.dispatchEvent(new KeyboardEvent('keydown', {
      key: value, bubbles: true, cancelable: true, ...options,
    }));
    key('2', { metaKey: true });
    const towerActive = document.querySelector('.page.active').dataset.page;
    key('k', { metaKey: true });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const connectActive = document.querySelector('.page.active').dataset.page;
    const workspaceOpenCount = window.api.testState().workspaceOpenCount;
    document.getElementById('manageResources').click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const bookmarkManagerOpenCount = window.api.testState().bookmarkManagerOpenCount;
    const legacyManagerClosed = !document.getElementById('resourceDialog').open;

    const favorite = document.querySelector('.resource-favorite');
    favorite.click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const toast = document.getElementById('globalToast');
    const nav = document.querySelector('.nav[data-page="connect"]');
    return {
      towerActive, connectActive, workspaceOpenCount, bookmarkManagerOpenCount, legacyManagerClosed,
      toastVisible: !toast.hidden, toastText: toast.textContent,
      statusClass: document.getElementById('navConnectionState').className,
      statusLabel: nav.getAttribute('aria-label'),
    };
  })()`);
  assert.equal(result.towerActive, 'tower', 'Command-2 did not open Control Tower');
  assert.equal(result.connectActive, 'connect', 'Command-K did not open Campus Services');
  assert.equal(result.workspaceOpenCount, 1, 'Command-K did not open Campus Workspace');
  assert.equal(result.bookmarkManagerOpenCount, 1, 'Organize did not open the bookmark manager');
  assert.equal(result.legacyManagerClosed, true, 'Organize reopened the legacy website dialog');
  assert.equal(result.toastVisible, true, 'favorite feedback toast stayed hidden');
  assert.match(result.toastText, /收藏/u);
  assert.match(result.statusClass, /disconnected/u);
  assert.match(result.statusLabel, /未连接[\s\S]*⌘1/u);
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
    ['wide-tall', 1200, 900],
  ]) {
    window.setContentSize(width, height);
    await waitFor(window, `window.innerWidth === ${width}`, `${label} screenshot width`);
    for (const page of ['connect', 'tower', 'notif', 'settings']) {
      await window.webContents.executeJavaScript(`(() => {
        for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
        document.getElementById('globalToast').hidden = true;
        document.querySelector('.nav[data-page="${page}"]').click();
        document.querySelector('.content').scrollTop = 0;
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(
          () => setTimeout(resolve, 260),
        )));
      })()`);
      const image = await window.webContents.capturePage();
      fs.writeFileSync(path.join(output, `${label}-${page}.png`), image.toPNG());
    }
    if (label === 'compact') {
      await window.webContents.executeJavaScript(`(async () => {
        for (const dialog of document.querySelectorAll('dialog[open]')) { try { dialog.close(); } catch {} }
        document.getElementById('globalToast').hidden = true;
        document.querySelectorAll('.nav').forEach((nav) => nav.classList.toggle('active', nav.dataset.page === 'connect'));
        document.querySelectorAll('.page').forEach((page) => {
          const active = page.dataset.page === 'connect';
          page.classList.toggle('active', active);
          page.hidden = !active;
        });
        const search = document.getElementById('resourceSearch');
        search.value = 'no-such-campus-service';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(
          () => setTimeout(resolve, 240),
        )));
      })()`);
      fs.writeFileSync(path.join(output, 'compact-empty.png'), (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-resource-empty-action="clear"]').click();
        document.querySelector('.resource-favorite').click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 40));
      fs.writeFileSync(path.join(output, 'compact-toast.png'), (await window.webContents.capturePage()).toPNG());
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
    await exerciseIntegrationCenter(window);
    for (const [width, height] of [[500, 640], [420, 560], [760, 900]]) {
      assertLayout(await measureAt(window, width, height), width, height);
    }
    assertCustomResourceSave(await saveCustomResource(window));
    assertCustomResourceAddAndOpen(await addAndOpenCustomResource(window));
    await exerciseBuiltinResourceRemoval(window);
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
