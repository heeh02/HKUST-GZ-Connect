'use strict';

const fs = require('fs');
const path = require('path');
const { ensureOwnerOnly } = require('./private-file');
const { DEFAULT_ROUTE_DOMAINS, normalizeRouteDomains } = require('./pac');
const { normalizeCustomResources } = require('./campus-resources');

const DEFAULTS = Object.freeze({
  port: 1080,
  username: '',
  autoReconnect: true,
  maxAttempts: 3,
  startAtLogin: false,
  autoConnect: true,
  closeAction: 'ask',
  routeDomains: DEFAULT_ROUTE_DOMAINS,
  customResources: [],
});

function isValidPort(port) {
  return Number.isInteger(port) && port >= 1025 && port <= 65535;
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
    routeDomains: normalizeRouteDomains(saved.routeDomains),
    customResources: normalizeCustomResources(saved.customResources),
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
  const normalized = normalizeSettings(settings);
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(normalized, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
    ensureOwnerOnly(file);
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {}
  }
  return normalized;
}

module.exports = { DEFAULTS, isValidPort, loadSettings, normalizeSettings, saveSettings };
