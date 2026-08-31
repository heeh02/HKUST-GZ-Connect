'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const renderer = path.join(__dirname, '..', 'renderer', 'index.html');
const preload = path.join(__dirname, 'resource-manager-layout-preload.js');

async function settle(window, width, height) {
  window.setContentSize(width, height);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await window.webContents.executeJavaScript(`window.innerWidth === ${width} && window.innerHeight === ${height}`);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 160))))');
}

async function shellSnapshot(window, page) {
  return window.webContents.executeJavaScript(`(() => {
    document.querySelector('.nav[data-page="${page}"]').click();
    const root = document.querySelector('.content');
    const visible = document.querySelector('.page.active');
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      page: visible.dataset.page,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      contentOverflow: root.scrollWidth - root.clientWidth,
      contentScroll: root.scrollTop,
      contentScrollHeight: root.scrollHeight,
      contentClientHeight: root.clientHeight,
      navOrder: [...document.querySelectorAll('.nav')].map((node) => node.dataset.page),
      resourceInsideConnect: !!document.querySelector('.page[data-page="connect"] #resourceShelf'),
      stacks: document.querySelectorAll('#campusResources .category-stack').length,
      layeredStacks: document.querySelectorAll('#campusResources .category-stack.layered').length,
      categoryNames: [...document.querySelectorAll('#campusResources .stacked-category-tab span, #campusResources .category-card > header h3')].map((node) => node.textContent),
      cards: document.querySelectorAll('#campusResources .category-card').length,
      stackRect: (() => { const r = document.getElementById('campusResources').getBoundingClientRect(); return { top: r.top, width: r.width, height: r.height, available: window.innerHeight - r.top - 28 }; })(),
      notificationNav: !!document.querySelector('.nav[data-page="notif"]'),
      networkTree: !!document.getElementById('networkTree'),
      networkTreeBranches: document.querySelectorAll('.network-tree-branch').length,
      underlayOptions: document.querySelectorAll('[data-underlay-address]').length,
      underlayInterfaces: document.querySelectorAll('[data-underlay-interface]').length,
      underlayOverflow: (() => { const node = document.getElementById('underlayTreeOptions'); return node.scrollWidth - node.clientWidth; })(),
      legacyUnderlaySelect: !!document.getElementById('underlaySourceAddress'),
      integrationRows: document.querySelectorAll('[data-integration-adapter]').length,
      routingScopes: document.querySelectorAll('.routing-consumer-scope > div').length,
      towerRoutingWidth: document.getElementById('towerRoutingSection')?.getBoundingClientRect().width || 0,
      towerGridWidth: document.querySelector('.page[data-page="tower"] .tower-grid')?.getBoundingClientRect().width || 0,
    }))));
  })()`);
}

async function capture(window, output, label) {
  if (!output) return;
  await new Promise((resolve) => setTimeout(resolve, 240));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${label}.png`), (await window.webContents.capturePage()).toPNG());
}

async function addWebsiteSnapshot(window) {
  return window.webContents.executeJavaScript(`(() => {
    document.getElementById('addWebsite').click();
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const dialog = document.getElementById('addWebsiteDialog');
      const rect = dialog.getBoundingClientRect();
      resolve({ open: dialog.open, left: rect.left, right: rect.right, top: rect.top,
        bottom: rect.bottom, width: rect.width, viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight, bodyOverflow: dialog.scrollWidth - dialog.clientWidth,
        routeOptions: [...document.getElementById('addWebsiteRoute').options].map(({ value }) => value) });
    })));
  })()`);
}

async function main() {
  await app.whenReady();
  const output = process.env.HKUSTGZ_CONTROL_SCREENSHOT_DIR || '';
  const window = new BrowserWindow({ show: false, width: 480, height: 854,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload } });
  try {
    await window.loadFile(renderer);
    await window.webContents.executeJavaScript("new Promise((resolve) => { const done = () => document.getElementById('dash').hidden ? setTimeout(done, 20) : resolve(); done(); })");
    if (process.env.HKUSTGZ_CONTROL_PREVIEW === '1') {
      window.show();
      await new Promise((resolve) => window.once('closed', resolve));
      return;
    }
    for (const [label, width, height] of [
      ['minimum', 440, 700], ['default', 480, 854], ['wide', 1180, 900],
      ['wide-tall', 1180, 1100], ['ultrawide', 1440, 1000],
    ]) {
      await settle(window, width, height);
      const connect = await shellSnapshot(window, 'connect');
      assert.deepEqual(connect.navOrder, ['connect', 'browser', 'tower', 'settings']);
      assert.equal(connect.notificationNav, false);
      assert.equal(connect.resourceInsideConnect, false);
      assert.equal(connect.networkTree, true);
      assert.equal(connect.networkTreeBranches, 0);
      assert.equal(connect.underlayOptions, 2);
      assert.equal(connect.underlayInterfaces, 2);
      assert.ok(connect.underlayOverflow <= 0, `${label}: adapter choices overflow horizontally`);
      assert.equal(connect.legacyUnderlaySelect, false);
      assert.ok(connect.bodyOverflow <= 0 && connect.contentOverflow <= 0, `${label}: connection shell overflows horizontally`);
      if (label === 'default' || label === 'wide' || label === 'wide-tall' || label === 'ultrawide') {
        assert.ok(connect.contentScrollHeight <= connect.contentClientHeight + 1,
          `${label}: connection page unexpectedly requires scrolling`);
      }
      await capture(window, output, `${label}-connect`);

      const browser = await shellSnapshot(window, 'browser');
      assert.equal(browser.categoryNames.length, 12, `${label}: an official category title is inaccessible`);
      assert.ok(browser.bodyOverflow <= 0 && browser.contentOverflow <= 0, `${label}: category shell overflows horizontally`);
      if (width === 1180 && height === 900) {
        assert.equal(browser.stacks, 3, `twelve categories and three slots must form three stacks: ${JSON.stringify(browser)}`);
        assert.equal(browser.layeredStacks, 3, 'every wide stack should expose its official categories');
      }
      if (width === 1180 && height === 1100) {
        assert.equal(browser.stacks, 6, `a taller three-column window must unfold into six stacks: ${JSON.stringify(browser)}`);
        assert.equal(browser.layeredStacks, 6);
      }
      await capture(window, output, `${label}-browser`);
      const addWebsite = await addWebsiteSnapshot(window);
      assert.equal(addWebsite.open, true, `${label}: Add Website dialog did not open`);
      assert.deepEqual(addWebsite.routeOptions, ['auto', 'campus', 'direct']);
      assert.ok(addWebsite.left >= 8 && addWebsite.right <= addWebsite.viewportWidth - 8,
        `${label}: Add Website dialog escapes horizontal safe area: ${JSON.stringify(addWebsite)}`);
      assert.ok(addWebsite.top >= 8 && addWebsite.bottom <= addWebsite.viewportHeight - 8,
        `${label}: Add Website dialog escapes vertical safe area`);
      assert.ok(addWebsite.width <= 520 && addWebsite.bodyOverflow <= 0,
        `${label}: Add Website dialog is too wide or overflows`);
      await capture(window, output, `${label}-add-website`);
      await window.webContents.executeJavaScript(`document.getElementById('addWebsiteDialog').close()`);
      const tower = await shellSnapshot(window, 'tower');
      assert.equal(tower.contentScroll, 0, `${label}: Control Tower did not start at the top`);
      assert.ok(tower.bodyOverflow <= 0 && tower.contentOverflow <= 0, `${label}: Control Tower overflows horizontally`);
      assert.equal(tower.integrationRows, 2, `${label}: both independent export adapters must remain visible`);
      assert.equal(tower.routingScopes, 3, `${label}: routing scope explanation is incomplete`);
      if (width >= 1180) assert.ok(tower.towerRoutingWidth >= tower.towerGridWidth - 1,
        `${label}: website routing does not use the full Control Tower width`);
      await capture(window, output, `${label}-tower`);
      await shellSnapshot(window, 'settings'); await capture(window, output, `${label}-settings`);
    }
    const categoryModes = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('.nav[data-page="browser"]').click();
      document.getElementById('categoryModePersonal').click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const personal = {
        selected: document.getElementById('categoryModePersonal').getAttribute('aria-selected'),
        names: [...document.querySelectorAll('#campusResources .stacked-category-tab span, #campusResources .category-card > header h3')].map((node) => node.textContent),
      };
      document.getElementById('categoryModeCatalog').click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { personal, catalog: {
        selected: document.getElementById('categoryModeCatalog').getAttribute('aria-selected'),
        names: [...document.querySelectorAll('#campusResources .stacked-category-tab span, #campusResources .category-card > header h3')].map((node) => node.textContent),
      } };
    })()`);
    assert.equal(categoryModes.personal.selected, 'true');
    assert.equal(categoryModes.personal.names.length, 6, 'personal mode must keep six user folders');
    assert.equal(categoryModes.catalog.selected, 'true');
    assert.equal(categoryModes.catalog.names.length, 12, 'catalog mode must restore all official task categories');
    const catalogSearch = await window.webContents.executeJavaScript(`(async () => {
      const input = document.getElementById('resourceSearch');
      input.value = '科研';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = {
        headings: [...document.querySelectorAll('#campusResources .category-search-section h3')].map((node) => node.textContent),
        sites: document.querySelectorAll('#campusResources .category-site').length,
      };
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return result;
    })()`);
    assert.ok(catalogSearch.headings.some((name) => name.includes('科研')));
    assert.equal(catalogSearch.sites, 1, 'official category search must return its reviewed site');
    window.setContentSize(760, 900);
    window.webContents.setZoomFactor(2);
    await new Promise((resolve) => setTimeout(resolve, 260));
    const zoomConnect = await shellSnapshot(window, 'connect');
    assert.ok(zoomConnect.bodyOverflow <= 0 && zoomConnect.contentOverflow <= 0 &&
      zoomConnect.underlayOverflow <= 0, '200% zoom: connection controls overflow horizontally');
    const zoomTower = await shellSnapshot(window, 'tower');
    assert.ok(zoomTower.bodyOverflow <= 0 && zoomTower.contentOverflow <= 0,
      '200% zoom: Control Tower overflows horizontally');
    assert.equal(zoomTower.integrationRows, 2, '200% zoom: an export adapter became inaccessible');
    window.webContents.setZoomFactor(1);
    const underlaySwitch = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.nav[data-page="connect"]').click();
      const target = document.querySelector('[data-underlay-address="198.18.0.1"]');
      target.click();
      return new Promise((resolve) => {
        const deadline = Date.now() + 2000;
        const check = () => {
          const selected = document.querySelector('[data-underlay-address="198.18.0.1"]');
          if (selected?.getAttribute('aria-checked') === 'true') {
            resolve({ selected: true, active: selected.classList.contains('active'), status: document.getElementById('underlaySelectionStatus').textContent });
          } else if (Date.now() >= deadline) resolve({ selected: false, active: false, status: '' });
          else setTimeout(check, 20);
        };
        check();
      });
    })()`);
    assert.equal(underlaySwitch.selected, true);
    assert.equal(underlaySwitch.active, true);
    assert.ok(underlaySwitch.status, 'switching a connection line must publish a status');
    const contextualApply = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('.nav[data-page="tower"]').click();
      const actions = document.getElementById('towerActions');
      const initialHidden = actions.hidden;
      const input = document.getElementById('maxAttempts');
      input.value = String(Number(input.value) === 3 ? 4 : 3);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const visibleWhenDirty = !actions.hidden;
      document.getElementById('towerSave').click();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && (!actions.hidden || document.getElementById('towerSaved').textContent)) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return { initialHidden, visibleWhenDirty, hiddenAfterSave: actions.hidden };
    })()`);
    assert.deepEqual(contextualApply, {
      initialHidden: true, visibleWhenDirty: true, hiddenAfterSave: true,
    }, 'Control Tower apply action must exist only while settings are dirty or confirming a save');
    const shortcut = await window.webContents.executeJavaScript(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
      return { page: document.querySelector('.page.active').dataset.page, focused: document.activeElement.id };
    })()`);
    assert.deepEqual(shortcut, { page: 'browser', focused: 'resourceSearch' });
    process.stdout.write('control shell layout: PASS\n');
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

main().then(() => app.quit(), (error) => { process.stderr.write(`${error.stack || error}\n`); app.exit(1); });
