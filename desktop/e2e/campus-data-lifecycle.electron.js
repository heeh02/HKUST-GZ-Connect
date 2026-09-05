'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadURL('data:text/html,<section class="module"><div id="scheduleBody"></div><button id="scheduleRefresh">Refresh</button></section>');
    await window.webContents.executeJavaScript(fs.readFileSync(path.join(
      __dirname, '..', 'renderer', 'campus-data-modules.js'), 'utf8'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      let requests = 0;
      let resolve;
      let published = 0;
      const timers = new Map();
      const snapshot = { sessionState: 'authenticated', modules: {
        schedule: { state: 'empty', items: [] },
      } };
      const feature = window.campusDataModules.create({
        document,
        api: {
          getCampusData: async () => snapshot,
          refreshCampusSchedule: () => { requests++; return new Promise(done => { resolve = done; }); },
        },
        translate: key => key, escapeHtml: value => String(value), openDeepLink: () => {},
        onCatalog: () => { published++; },
        setTimeout: (fn, delay) => { timers.set(fn, delay); return fn; },
        clearTimeout: fn => timers.delete(fn),
      });
      feature.start(); feature.start();
      await feature.load();
      const timerBefore = timers.size;
      document.getElementById('scheduleRefresh').click();
      const before = document.getElementById('scheduleBody').innerHTML;
      // Deliver the browser lifecycle event, not a direct dispose call.
      window.dispatchEvent(new Event('unload'));
      resolve(snapshot);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      document.getElementById('scheduleRefresh').click();
      document.dispatchEvent(new Event('app-locale-changed'));
      return { requests, published, timerBefore, timersAfter: timers.size,
        unchanged: before === document.getElementById('scheduleBody').innerHTML,
        snapshotCleared: feature.snapshot() === null, restart: feature.start() };
    })()`);
    assert.deepEqual(result, { requests: 1, published: 1, timerBefore: 1, timersAfter: 0,
      unchanged: true, snapshotCleared: true, restart: false });
    process.stdout.write('campus data lifecycle Electron: PASS\n');
  } finally {
    window.destroy();
  }
}
main().then(() => app.quit(), error => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
