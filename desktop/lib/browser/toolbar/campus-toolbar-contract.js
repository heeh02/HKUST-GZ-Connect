'use strict';

const NO_VALUE_COMMANDS = new Set([
  'back',
  'forward',
  'reload',
  'home',
  'manage-credential',
  'open-settings',
  'toggle-favorite',
  'focus-workspace',
  'manage-bookmarks',
  'open-bookmark-menu',
  'new-tab',
  'find-open',
  'find-close',
  'find-next',
  'find-prev',
]);
const TAB_COMMANDS = new Set(['switch-tab', 'close-tab']);
const TEXT_LIMITS = Object.freeze({ navigate: 2048, find: 512 });
const RESOURCE_ID = /^[a-z0-9-]{1,40}$/u;
const GROUP_ID = /^group_[a-z0-9_-]{12,64}$/u;
const ROUTES = new Set(['auto', 'campus', 'direct']);

function normalizeToolbarCommand(rawCommand, rawValue = '') {
  if (typeof rawCommand !== 'string') return null;
  const command = rawCommand;
  if (NO_VALUE_COMMANDS.has(command)) return { command, value: '' };
  if (TAB_COMMANDS.has(command)) {
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return { command, value };
  }
  if (command === 'set-route') {
    return ROUTES.has(rawValue) ? { command, value: rawValue } : null;
  }
  if (command === 'open-resource') {
    return typeof rawValue === 'string' && RESOURCE_ID.test(rawValue)
      ? { command, value: rawValue } : null;
  }
  if (command === 'open-bookmark-folder') {
    return typeof rawValue === 'string' && GROUP_ID.test(rawValue)
      ? { command, value: rawValue } : null;
  }
  if (Object.hasOwn(TEXT_LIMITS, command)) {
    if (typeof rawValue !== 'string' || rawValue.length > TEXT_LIMITS[command] ||
        /[\u0000]/u.test(rawValue)) return null;
    return { command, value: rawValue };
  }
  return null;
}

function installToolbarBridge({ contextBridge, ipcRenderer }) {
  if (!contextBridge?.exposeInMainWorld || !ipcRenderer?.send || !ipcRenderer?.on ||
      !ipcRenderer?.removeListener) return false;
  const subscribe = (channel, callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
  contextBridge.exposeInMainWorld('campusToolbar', Object.freeze({
    command(name, value = '') {
      const command = normalizeToolbarCommand(name, value);
      if (!command) return false;
      ipcRenderer.send('campus-toolbar-command', command);
      return true;
    },
    onState(callback) {
      return subscribe('campus-toolbar-state', callback);
    },
    onLocale(callback) {
      return subscribe('campus-toolbar-locale', callback);
    },
    onFocus(callback) {
      return subscribe('campus-toolbar-focus', callback);
    },
  }));
  return true;
}

// Sandboxed Electron preloads can load their entry file and the built-in
// `electron` module, but cannot `require()` neighbouring project modules.
// Keeping the normalizer and bridge in this one reviewed file lets the real
// preload and Node tests execute the exact same command contract.
if (typeof process !== 'undefined' && process.type === 'renderer') {
  installToolbarBridge(require('electron'));
}

module.exports = {
  NO_VALUE_COMMANDS,
  TAB_COMMANDS,
  TEXT_LIMITS,
  installToolbarBridge,
  normalizeToolbarCommand,
};
