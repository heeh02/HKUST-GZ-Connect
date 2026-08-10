'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { registerTrustedIpcHandlers } = require('../lib/ipc-handlers');

test('trusted IPC registration binds the exact control contents and local file', async () => {
  const registered = new Map();
  const removed = [];
  const ipcMain = {
    handle: (channel, handler) => registered.set(channel, handler),
    removeHandler: (channel) => removed.push(channel),
  };
  const control = { getURL: () => pathToFileURL('/app/renderer/index.html').href };
  const dispose = registerTrustedIpcHandlers({
    ipcMain,
    getWebContents: () => control,
    allowedFiles: ['/app/renderer/index.html'],
    handlers: { ping: (_event, value) => ({ value }) },
  });
  const event = {
    sender: control,
    senderFrame: { url: pathToFileURL(path.resolve('/app/renderer/index.html')).href },
  };
  assert.deepEqual(await registered.get('ping')(event, 7), { value: 7 });
  assert.throws(() => registered.get('ping')({
    sender: control,
    senderFrame: { url: pathToFileURL('/tmp/other.html').href },
  }, 7), /不受信任/);
  assert.throws(() => registered.get('ping')({
    sender: { getURL: control.getURL },
    senderFrame: event.senderFrame,
  }, 7), /不受信任/);
  control.destroyed = true;
  dispose();
  assert.deepEqual(removed, ['ping']);
});
