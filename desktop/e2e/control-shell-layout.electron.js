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
      boardId: visible.querySelector('[data-card-board]')?.dataset.boardId || null,
      boardEditing: visible.querySelector('[data-card-board]')?.dataset.editing || null,
      decks: visible.querySelector('[data-card-board]')?.querySelectorAll('[data-card-deck-id]').length || 0,
      categoryNames: [...(visible.querySelector('[data-card-board]')?.querySelectorAll('[data-card-ref-kind="official-category"] .cb-card-title') || [])].map((node) => node.textContent),
      cards: visible.querySelector('[data-card-board]')?.querySelectorAll('[data-card-placement-id]').length || 0,
      expandedCards: visible.querySelector('[data-card-board]')?.querySelectorAll('[data-card-placement-id][data-expanded="true"]').length || 0,
      dragHandles: visible.querySelector('[data-card-board]')?.querySelectorAll('[data-card-drag-handle]').length || 0,
      nestedCardScrollers: [...(visible.querySelector('[data-card-board]')?.querySelectorAll('.cb-card-body, .cb-site-list') || [])]
        .filter((node) => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)).length,
      powerInsideBoard: !!document.querySelector('[data-card-board] #power'),
      connectionControlDraggable: !!document.querySelector('#connTop [draggable="true"], #connTop [data-card-drag-handle]'),
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

async function exerciseCardExpansion(window) {
  return window.webContents.executeJavaScript(`(async () => {
    document.querySelector('.nav[data-page="browser"]').click();
    document.getElementById('categoryModeCatalog').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const deck = document.querySelector('#campusResources .cb-deck.is-stacked');
    const deckId = deck.dataset.cardDeckId;
    const cards = [...deck.querySelectorAll(':scope > [data-card-placement-id]')];
    const targetPlacementId = cards[1].dataset.cardPlacementId;
    const before = deck.getBoundingClientRect();
    cards[1].querySelector('[data-card-action="toggle"]').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const updatedDeck = document.querySelector('[data-card-deck-id="' + deckId + '"]');
    const updatedCards = [...updatedDeck.querySelectorAll(':scope > [data-card-placement-id]')];
    const target = updatedCards.find((card) => card.dataset.cardPlacementId === targetPlacementId);
    const sibling = updatedCards.find((card) => card.dataset.cardPlacementId !== targetPlacementId);
    const after = updatedDeck.getBoundingClientRect();
    const body = target.querySelector('.cb-card-body');
    const sites = body.querySelector('.cb-site-list');
    return {
      cardCount: updatedCards.length,
      deckStayedInPlace: Math.abs(before.left - after.left) <= 1 && Math.abs(before.top - after.top) <= 1,
      targetExpanded: target.dataset.expanded,
      siblingExpanded: sibling.dataset.expanded,
      expandedInDeck: updatedDeck.querySelectorAll('[data-expanded="true"]').length,
      bodyWidth: body.getBoundingClientRect().width,
      siteColumns: getComputedStyle(sites).gridTemplateColumns.split(' ').filter(Boolean).length,
      bodyOverflowY: getComputedStyle(body).overflowY,
    };
  })()`);
}

async function exerciseInlineOrganizeAndPin(window) {
  return window.webContents.executeJavaScript(`(async () => {
    document.querySelector('.nav[data-page="browser"]').click();
    document.getElementById('categoryModeCatalog').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const beforeManagerCount = window.api.testState().bookmarkManagerOpenCount;
    document.getElementById('manageResources').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const boardHost = document.querySelector('#campusResources .cb-catalog-board .cb-board-host');
    let board = boardHost.querySelector('[data-card-board]');
    const toolbar = document.querySelector('[data-card-edit-toolbar], .cb-edit-toolbar');
    const editingDuring = board.dataset.editing;
    const pageDuringEdit = document.querySelector('.page.active')?.dataset.page;
    const actions = [...toolbar.querySelectorAll('[data-board-action]')]
      .map((button) => button.dataset.boardAction).sort();
    const handlesInEdit = board.querySelectorAll('[data-card-drag-handle]').length;
    const handle = board.querySelector('[data-card-drag-handle]');
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    board = boardHost.querySelector('[data-card-board]');
    const movedHandle = board.querySelector('[data-keyboard-picked="true"] [data-card-drag-handle]') ||
      board.querySelector('[data-card-drag-handle]');
    movedHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const keyboardAnnouncement = document.getElementById('cardBoardLiveRegion')?.textContent || '';
    board = boardHost.querySelector('[data-card-board]');
    const pin = board.querySelector('[data-card-edit-action="pin"]');
    const sourceRefId = pin.closest('[data-card-placement-id]').dataset.cardRefId;
    pin.click();
    toolbar.querySelector('[data-board-action="done"]').click();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && board.dataset.editing === 'true') {
      await new Promise((resolve) => setTimeout(resolve, 20));
      board = boardHost.querySelector('[data-card-board]');
    }
    const afterManagerCount = window.api.testState().bookmarkManagerOpenCount;
    const commitState = window.api.testState().cardBoardRequests;
    const sourceStillVisible = !!document.querySelector(
      '#campusResources [data-card-ref-kind="official-category"]' +
      '[data-card-ref-id="' + sourceRefId + '"]',
    );
    document.querySelector('.nav[data-page="connect"]').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const connectBoard = document.querySelector('.page[data-page="connect"] [data-card-board]');
    const pinnedCard = connectBoard?.querySelector(
      '[data-card-ref-kind="official-category"][data-card-ref-id="' + sourceRefId + '"]',
    );
    pinnedCard?.querySelector('[data-card-action="toggle"]')?.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const expandedPinnedCard = document.querySelector(
      '.page[data-page="connect"] [data-card-ref-kind="official-category"]' +
      '[data-card-ref-id="' + sourceRefId + '"]',
    );
    const pinnedResourceId = expandedPinnedCard
      ?.querySelector('[data-card-resource-id]')?.dataset.cardResourceId || null;
    expandedPinnedCard?.querySelector('[data-resource-action="open"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      pageDuringEdit,
      editingDuring,
      editingAfterSave: boardHost.querySelector('[data-card-board]').dataset.editing,
      actions,
      handlesInEdit,
      keyboardAnnouncement,
      managerCalls: afterManagerCount - beforeManagerCount,
      commitCalls: commitState.commit,
      lastOperations: commitState.lastOperations,
      sourceStillVisible,
      connectBoardId: connectBoard?.dataset.boardId || null,
      pinnedVisible: !!connectBoard?.querySelector(
        '[data-card-ref-kind="official-category"][data-card-ref-id="' + sourceRefId + '"]',
      ),
      pinnedResourceId,
      pinnedOpenRequest: window.api.testState().lastOpenRequest,
      fixedPowerOutsideBoard: !document.querySelector('[data-card-board] #power'),
    };
  })()`);
}

async function reducedMotionSnapshot(window) {
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  return window.webContents.executeJavaScript(`(() => {
    document.querySelector('.nav[data-page="browser"]').click();
    const card = document.querySelector('#campusResources .cb-card');
    const body = card.querySelector('.cb-card-body');
    return {
      cardAnimation: getComputedStyle(card).animationName,
      bodyAnimation: getComputedStyle(body).animationName,
      cardTransitionMs: getComputedStyle(card).transitionDuration,
    };
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
      ['minimum', 820, 540], ['default', 1024, 576], ['wide', 1280, 720],
      ['ultrawide', 1440, 900],
    ]) {
      await settle(window, width, height);
      const connect = await shellSnapshot(window, 'connect');
      assert.deepEqual(connect.navOrder, ['connect', 'browser', 'tower', 'settings']);
      assert.equal(connect.notificationNav, false);
      assert.equal(connect.resourceInsideConnect, false);
      assert.equal(connect.powerInsideBoard, false, `${label}: fixed connection action entered the movable board`);
      assert.equal(connect.connectionControlDraggable, false,
        `${label}: the fixed connection safety region became draggable`);
      assert.equal(connect.networkTree, true);
      assert.equal(connect.networkTreeBranches, 0);
      assert.equal(connect.underlayOptions, 2);
      assert.equal(connect.underlayInterfaces, 2);
      assert.ok(connect.underlayOverflow <= 0, `${label}: adapter choices overflow horizontally`);
      assert.equal(connect.legacyUnderlaySelect, false);
      assert.ok(connect.bodyOverflow <= 0 && connect.contentOverflow <= 0, `${label}: connection shell overflows horizontally`);
      if (label === 'default' || label === 'wide' || label === 'ultrawide') {
        assert.ok(connect.contentScrollHeight <= connect.contentClientHeight + 1,
          `${label}: connection page unexpectedly requires scrolling`);
      }
      await capture(window, output, `${label}-connect`);

      const browser = await shellSnapshot(window, 'browser');
      assert.equal(browser.categoryNames.length, 12, `${label}: an official category title is inaccessible`);
      assert.equal(browser.boardId, 'browser-catalog', `${label}: official cards use the wrong board`);
      assert.equal(browser.boardEditing, 'false', `${label}: browsing opened in editing mode`);
      assert.equal(browser.cards, 12, `${label}: official cards are missing`);
      assert.equal(browser.dragHandles, 0, `${label}: ordinary browsing exposed drag handles`);
      assert.equal(browser.nestedCardScrollers, 0, `${label}: card content owns a permanent inner scrollbar`);
      assert.ok(browser.bodyOverflow <= 0 && browser.contentOverflow <= 0, `${label}: category shell overflows horizontally`);
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
        boardId: document.querySelector('#campusResources .cb-personal-board [data-card-board]')?.dataset.boardId,
        names: [...document.querySelectorAll('#campusResources .cb-personal-board .cb-card-title')].map((node) => node.textContent),
      };
      document.getElementById('categoryModeCatalog').click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { personal, catalog: {
        selected: document.getElementById('categoryModeCatalog').getAttribute('aria-selected'),
        boardId: document.querySelector('#campusResources .cb-catalog-board [data-card-board]')?.dataset.boardId,
        names: [...document.querySelectorAll('#campusResources .cb-catalog-board .cb-card-title')].map((node) => node.textContent),
      } };
    })()`);
    assert.equal(categoryModes.personal.selected, 'true');
    assert.equal(categoryModes.personal.boardId, 'browser-personal');
    assert.equal(categoryModes.personal.names.length, 6,
      'personal mode must keep all six populated user folders');
    assert.equal(categoryModes.catalog.selected, 'true');
    assert.equal(categoryModes.catalog.boardId, 'browser-catalog');
    assert.equal(categoryModes.catalog.names.length, 12, 'catalog mode must restore all official task categories');
    const catalogSearch = await window.webContents.executeJavaScript(`(async () => {
      const input = document.getElementById('resourceSearch');
      input.value = '科研';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = {
        headings: [...document.querySelectorAll('#campusResources .cb-catalog-board .cb-search-section h3')].map((node) => node.textContent),
        sites: document.querySelectorAll('#campusResources .cb-catalog-board .cb-site').length,
      };
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return result;
    })()`);
    assert.ok(catalogSearch.headings.some((name) => name.includes('科研')));
    assert.equal(catalogSearch.sites, 1, 'official category search must return its reviewed site');
    await window.webContents.executeJavaScript(`(() => {
      const input = document.getElementById('resourceSearch');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const expansion = await exerciseCardExpansion(window);
    assert.ok(expansion.cardCount >= 2, 'the deck fixture did not expose two cards');
    assert.equal(expansion.deckStayedInPlace, true, 'click expansion moved its deck to another slot');
    assert.equal(expansion.targetExpanded, 'true', 'the clicked card did not expand in place');
    assert.equal(expansion.siblingExpanded, 'false', 'the sibling in the same deck stayed expanded');
    assert.equal(expansion.expandedInDeck, 1, 'a deck exposed more than one expanded card');
    assert.ok(expansion.bodyWidth >= 440, 'wide-card fixture did not reach the two-column threshold');
    assert.equal(expansion.siteColumns, 2, 'a card at least 440px wide did not show two site columns');
    assert.notEqual(expansion.bodyOverflowY, 'auto', 'expanded card added an inner scrollbar');
    assert.notEqual(expansion.bodyOverflowY, 'scroll', 'expanded card added an inner scrollbar');

    const organize = await exerciseInlineOrganizeAndPin(window);
    assert.equal(organize.pageDuringEdit, 'browser', 'Organize navigated away from the current board');
    assert.equal(organize.editingDuring, 'true', 'Organize did not enter inline editing');
    assert.equal(organize.editingAfterSave, 'false', 'Done did not leave inline editing');
    assert.deepEqual(organize.actions, ['cancel', 'done', 'redo', 'reset', 'undo']);
    assert.equal(organize.handlesInEdit, 12, 'editing did not expose one drag handle per official card');
    assert.match(organize.keyboardAnnouncement, /取消|移动/u,
      'keyboard move did not publish a live announcement');
    assert.equal(organize.managerCalls, 0, 'Organize still opened the detached bookmark manager');
    assert.ok(organize.commitCalls >= 1, 'Done did not commit the inline layout draft');
    assert.ok(organize.lastOperations.some(({ type }) => type === 'pin-to-board'),
      'pinning did not reach the revision-bound layout commit');
    assert.equal(organize.sourceStillVisible, true, 'pinning moved the source card out of Campus Browser');
    assert.equal(organize.connectBoardId, 'connect', 'connection cards use the wrong board');
    assert.equal(organize.pinnedVisible, true, 'the pinned category did not appear on Connection');
    assert.ok(organize.pinnedResourceId, 'the pinned category did not expose its website content');
    assert.equal(organize.pinnedOpenRequest?.resourceId, organize.pinnedResourceId,
      'a website pinned to Connection did not open through its ID-only Main action');
    assert.equal(organize.fixedPowerOutsideBoard, true, 'the connection switch entered the movable board');
    await capture(window, output, 'pinned-connect');

    const reducedMotion = await reducedMotionSnapshot(window);
    assert.equal(reducedMotion.cardAnimation, 'none');
    assert.equal(reducedMotion.bodyAnimation, 'none');
    window.setContentSize(820, 540);
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
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    if (!window.isDestroyed()) window.destroy();
  }
}

main().then(() => app.quit(), (error) => { process.stderr.write(`${error.stack || error}\n`); app.exit(1); });
