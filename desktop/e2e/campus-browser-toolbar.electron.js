'use strict';

// Drives the real campus-browser chrome (toolbar + tabs) with a real
// CampusBrowser against loopback URLs that fail fast, without any network.

const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView, session } = require('electron');
const { CampusBrowser, FIND_BAR_HEIGHT, TOOLBAR_HEIGHT } = require('../lib/browser/session/campus-browser');
const { CAMPUS_PARTITION } = require('../lib/routing/policy/campus-route');

// Chromium blocks port 1 outright (ERR_UNSAFE_PORT), so tabs settle on the
// local error page immediately instead of hanging the test.
const DEAD_URL = 'http://route-switch.example.invalid:1/x';

async function waitFor(window, expression, description) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForMain(condition, description) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function toolbarCommand(browser, command, value = '') {
  return browser.window.webContents.executeJavaScript(
    `window.campusToolbar.command(${JSON.stringify(command)}, ${JSON.stringify(value)})`,
  );
}

async function assertDragRegions(browser) {
  const regions = await browser.window.webContents.executeJavaScript(`(() => {
    const pick = (selector) => getComputedStyle(document.querySelector(selector))
      .getPropertyValue('-webkit-app-region');
    return {
      routeSelector: pick('#routeSelector'),
      back: pick('#back'),
      address: pick('#address'),
      findBar: pick('#findBar'),
      findInput: pick('#findInput'),
      findPrev: pick('#findPrev'),
      findNext: pick('#findNext'),
      findClose: pick('#findClose'),
    };
  })()`);
  for (const [control, region] of Object.entries(regions)) {
    assert.equal(region, 'no-drag', `${control} must not be part of the window drag region`);
  }
}

async function assertRouteSwitch(browser) {
  await waitForMain(
    () => browser.activeTab()?.failedUrl === DEAD_URL,
    'initial tab to settle on its error page',
  );
  assert.equal(browser.activeTab().route, 'campus');

  await browser.window.webContents.executeJavaScript(`(() => {
    const selector = document.getElementById('routeSelector');
    selector.value = 'direct';
    selector.dispatchEvent(new Event('change'));
  })()`);
  await waitForMain(() => browser.activeTab()?.route === 'direct', 'route switch to direct');
  assert.equal(
    browser.activeTab().view.webContents.session,
    session.fromPartition(CAMPUS_PARTITION),
    'route changes must preserve the one browser session and its SSO state',
  );
  await waitFor(
    browser.window,
    "document.getElementById('routeSelector').value === 'direct'",
    'route selector to follow the tab route',
  );
}

async function assertFindBar(browser) {
  const contents = browser.activeTab().view.webContents;
  const findCalls = [];
  const stopCalls = [];
  contents.findInPage = (text, options) => {
    findCalls.push([text, options]);
    return 1;
  };
  contents.stopFindInPage = (action) => stopCalls.push(action);

  await toolbarCommand(browser, 'find-open');
  await waitFor(
    browser.window,
    "document.getElementById('findBar').hidden === false",
    'find bar to open',
  );
  assert.equal(browser.findOpen, true);
  assert.equal(
    browser.activeTab().view.getBounds().y,
    TOOLBAR_HEIGHT + FIND_BAR_HEIGHT,
    'the page must move below the open find bar',
  );

  await toolbarCommand(browser, 'find', '校园');
  await waitForMain(() => findCalls.length > 0, 'findInPage for the query');
  assert.deepEqual(findCalls.at(-1), ['校园', undefined]);

  await toolbarCommand(browser, 'find-next');
  await waitForMain(() => findCalls.length > 1, 'find-next to repeat the search');
  assert.deepEqual(findCalls.at(-1), ['校园', { forward: true, findNext: true }]);

  await toolbarCommand(browser, 'find-prev');
  await waitForMain(() => findCalls.length > 2, 'find-prev to search backwards');
  assert.deepEqual(findCalls.at(-1), ['校园', { forward: false, findNext: true }]);

  await toolbarCommand(browser, 'find-close');
  await waitFor(
    browser.window,
    "document.getElementById('findBar').hidden === true",
    'find bar to close',
  );
  assert.equal(browser.findOpen, false);
  assert.deepEqual(stopCalls, ['clearSelection']);
  assert.equal(browser.activeTab().view.getBounds().y, TOOLBAR_HEIGHT);
}

async function main() {
  await app.whenReady();
  const errors = [];
  const browser = new CampusBrowser({
    BrowserWindow,
    WebContentsView,
    session,
    dialog: {
      showSaveDialog: async () => ({ canceled: true }),
      showMessageBox: async () => ({ response: 1 }),
    },
    certificateTrust: { isTrusted: () => false, trust: () => {} },
    credentialVault: null,
    parentWindow: () => null,
    toolbarFile: path.join(__dirname, '..', 'renderer', 'campus-browser.html'),
    toolbarPreload: path.join(__dirname, '..', 'lib', 'browser', 'toolbar', 'campus-toolbar-contract.js'),
    campusPreload: path.join(__dirname, '..', 'campus-preload.js'),
    onError: (message) => errors.push(message),
  });

  try {
    await browser.open(DEAD_URL, 11080, 'campus');
    browser.window.hide();
    await waitFor(browser.window, '!!window.campusBrowserUI', 'toolbar initialization');

    await assertDragRegions(browser);
    await assertRouteSwitch(browser);
    await assertFindBar(browser);
    assert.deepEqual(errors, [], `unexpected campus browser errors: ${errors.join('; ')}`);
    process.stdout.write('campus browser toolbar: PASS\n');
  } finally {
    browser.close();
  }
}

main().then(
  () => app.quit(),
  (error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  },
);
