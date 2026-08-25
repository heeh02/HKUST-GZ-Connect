'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, Menu, nativeImage } = require('electron');
const { DesktopShell } = require('../lib/desktop-shell');

const TIMEOUT_MS = 15_000;

// Match production: losing the control renderer must not terminate the tray
// owner while the recovery policy decides whether another window is safe.
app.on('window-all-closed', () => {});

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitFor(predicate, message) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error(message);
}

async function run() {
  await app.whenReady();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'control-renderer-recovery-'));
  const renderer = path.join(directory, 'index.html');
  const preload = path.join(directory, 'preload.js');
  fs.writeFileSync(renderer, '<!doctype html><meta charset="utf-8"><title>fixture</title>');
  fs.writeFileSync(preload, "'use strict';\n");
  const errors = [];
  const shell = new DesktopShell({
    app,
    BrowserWindow,
    Tray: class {},
    Menu,
    nativeImage,
    dialog: { showMessageBox: async () => ({ response: 2, checkboxChecked: false }) },
    baseDirectory: path.join(__dirname, '..'),
    controlRendererFile: renderer,
    preloadFile: preload,
    platform: process.platform,
    translate: (key) => key,
    getConnectionState: () => ({ connected: false, connecting: false }),
    getCloseAction: () => 'minimize',
    connect: async () => ({ ok: true }),
    disconnect: async () => ({ ok: true }),
    openCampusBrowser: async () => ({ ok: true }),
    rememberCloseAction: async () => {},
    disposeLifecycle: () => {},
    cleanupQuit: async () => {},
    onControlRendererUnavailable: () => {},
    onWindowError: (error) => errors.push(error),
  });

  try {
    const first = shell.createWindow();
    await waitFor(() => !first.webContents.isLoading(), 'first control renderer did not load');
    first.webContents.forcefullyCrashRenderer();
    await waitFor(() => shell.window && shell.window !== first,
      'the first renderer crash was not recovered');
    const recovery = shell.window;
    await waitFor(() => !recovery.webContents.isLoading(), 'recovery renderer did not load');
    recovery.webContents.forcefullyCrashRenderer();
    await waitFor(() => shell.window === null, 'the repeated crash kept restarting the renderer');

    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'CONTROL_RENDERER_CRASH_LOOP_BLOCKED');
    process.stdout.write('control renderer recovery: PASS\n');
  } finally {
    if (shell.window && !shell.window.isDestroyed()) shell.window.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

run().then(() => app.quit()).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
