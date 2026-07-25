'use strict';

const fs = require('fs');

const DEFAULTS = Object.freeze({
  port: 1080,
  username: '',
  autoReconnect: true,
  maxAttempts: 3,
  startAtLogin: false,
  autoConnect: true,
  closeAction: 'ask',
});

function isValidPort(port) {
  return Number.isInteger(port) && port >= 1025 && port <= 65534;
}

function normalizeSettings(saved = {}) {
  const port = Number(saved.port);
  const maxAttempts = Number(saved.maxAttempts);
  return {
    username: typeof saved.username === 'string' ? saved.username : DEFAULTS.username,
    port: isValidPort(port) ? port : DEFAULTS.port,
    autoReconnect: saved.autoReconnect !== false,
    maxAttempts: Number.isInteger(maxAttempts)
      ? Math.max(0, Math.min(10, maxAttempts))
      : DEFAULTS.maxAttempts,
    startAtLogin: saved.startAtLogin === true,
    autoConnect: saved.autoConnect !== false,
    closeAction: ['ask', 'minimize', 'quit'].includes(saved.closeAction)
      ? saved.closeAction
      : DEFAULTS.closeAction,
  };
}

function loadSettings(file) {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(file, settings) {
  fs.writeFileSync(file, JSON.stringify(normalizeSettings(settings), null, 2), { mode: 0o600 });
}

module.exports = { DEFAULTS, isValidPort, loadSettings, normalizeSettings, saveSettings };
