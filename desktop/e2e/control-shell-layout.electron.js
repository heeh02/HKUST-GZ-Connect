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
      legacyUnderlaySelect: !!document.getElementById('underlaySourceAddress'),
    }))));
  })()`);
}

async function capture(window, output, label) {
  if (!output) return;
  await new Promise((resolve) => setTimeout(resolve, 240));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${label}.png`), (await window.webContents.capturePage()).toPNG());
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
      assert.equal(connect.legacyUnderlaySelect, false);
      assert.ok(connect.bodyOverflow <= 0 && connect.contentOverflow <= 0, `${label}: connection shell overflows horizontally`);
      if (label === 'default' || label === 'wide' || label === 'wide-tall' || label === 'ultrawide') {
        assert.ok(connect.contentScrollHeight <= connect.contentClientHeight + 1,
          `${label}: connection page unexpectedly requires scrolling`);
      }
      await capture(window, output, `${label}-connect`);

      const browser = await shellSnapshot(window, 'browser');
      assert.equal(browser.categoryNames.length, 6, `${label}: a category title is inaccessible`);
      assert.ok(browser.bodyOverflow <= 0 && browser.contentOverflow <= 0, `${label}: category shell overflows horizontally`);
      if (width === 1180 && height === 900) {
        assert.equal(browser.stacks, 3, `six categories and three slots must form three stacks: ${JSON.stringify(browser)}`);
        assert.equal(browser.layeredStacks, 3, 'every wide stack should expose two categories');
      }
      if (width === 1180 && height === 1100) {
        assert.equal(browser.stacks, 6, `a taller three-column window must fully unfold six categories: ${JSON.stringify(browser)}`);
        assert.equal(browser.layeredStacks, 0);
      }
      await capture(window, output, `${label}-browser`);
      const tower = await shellSnapshot(window, 'tower'); assert.equal(tower.contentScroll, 0, `${label}: Control Tower did not start at the top`); await capture(window, output, `${label}-tower`);
      await shellSnapshot(window, 'settings'); await capture(window, output, `${label}-settings`);
    }
    const underlaySwitch = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.nav[data-page="connect"]').click();
      const target = document.querySelector('[data-underlay-address="198.18.0.1"]');
      target.click();
      return new Promise((resolve) => {
        const deadline = Date.now() + 2000;
        const check = () => {
          const selected = document.querySelector('[data-underlay-address="198.18.0.1"]');
          if (selected?.getAttribute('aria-pressed') === 'true') {
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
