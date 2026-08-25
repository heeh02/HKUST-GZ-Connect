'use strict';

const { assertTrustedIpcSender } = require('./ipc-guard');

function registerTrustedIpcHandlers({
  ipcMain,
  getWebContents,
  allowedFiles,
  handlers,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      typeof getWebContents !== 'function' ||
      !handlers || typeof handlers !== 'object' || Array.isArray(handlers)) {
    throw new TypeError('invalid trusted IPC handler configuration');
  }
  const registered = [];
  for (const [channel, handler] of Object.entries(handlers)) {
    if (!/^[a-z0-9-]{1,64}$/u.test(channel) || typeof handler !== 'function') {
      throw new TypeError('invalid trusted IPC handler');
    }
    ipcMain.handle(channel, (event, ...args) => {
      const webContents = getWebContents();
      if (!webContents) throw new Error('应用窗口当前不可用');
      assertTrustedIpcSender(event, {
        webContents,
        allowedFiles,
      });
      return handler(event, ...args);
    });
    registered.push(channel);
  }
  return () => {
    for (const channel of registered) ipcMain.removeHandler?.(channel);
  };
}

module.exports = { registerTrustedIpcHandlers };
