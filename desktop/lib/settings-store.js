'use strict';

const fs = require('fs');
const path = require('path');
const { ensureOwnerOnly, readPrivateFileBounded } = require('./private-file');
const { DEFAULT_ROUTE_DOMAINS, normalizeRouteDomains } = require('./pac');
const { normalizeCustomResources } = require('./campus-resources');

const BACKUP_SUFFIX = '.bak';
// Version 2 restores SOCKS5 compatibility as the default. Version 1 briefly
// migrated every installation to strict authentication, which broke Clash and
// SSH clients that cannot receive the app's ephemeral credential.
const PROXY_SECURITY_VERSION = 2;
const MAX_SETTINGS_DOCUMENT_BYTES = 512 * 1024;
let temporarySequence = 0;

const DEFAULTS = Object.freeze({
  port: 1080,
  username: '',
  autoReconnect: true,
  maxAttempts: 3,
  startAtLogin: false,
  autoConnect: true,
  // Compatibility is the product default: Clash, SSH and existing SOCKS5
  // clients can use the loopback endpoint without app-specific credentials.
  // Shared-machine users can explicitly opt in to strict authentication.
  strictProxyAuth: false,
  proxySecurityVersion: PROXY_SECURITY_VERSION,
  closeAction: 'ask',
  language: 'auto',
  updateCheckedAt: 0,
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
    // Keep SOCKS5 NO_AUTH compatible by default. Only a choice saved by the
    // current compatibility-aware UI enables strict mode. This also repairs
    // version-1 settings that silently opted every user into authentication.
    strictProxyAuth: saved.proxySecurityVersion === PROXY_SECURITY_VERSION
      && saved.strictProxyAuth === true,
    proxySecurityVersion: PROXY_SECURITY_VERSION,
    closeAction: ['ask', 'minimize', 'quit'].includes(saved.closeAction)
      ? saved.closeAction
      : DEFAULTS.closeAction,
    language: ['auto', 'zh', 'en'].includes(saved.language)
      ? saved.language
      : DEFAULTS.language,
    updateCheckedAt: Number.isFinite(Number(saved.updateCheckedAt)) && Number(saved.updateCheckedAt) > 0
      ? Number(saved.updateCheckedAt)
      : DEFAULTS.updateCheckedAt,
    routeDomains: normalizeRouteDomains(saved.routeDomains),
    customResources: normalizeCustomResources(saved.customResources),
  };
}

function parseSettingsFile(file) {
  let bytes;
  try {
    bytes = readPrivateFileBounded(file, {
      maxBytes: MAX_SETTINGS_DOCUMENT_BYTES,
    }).data;
  } catch (error) {
    if (error.privateFileInvalid) error.settingsDocumentCorrupt = true;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) error.settingsDocumentCorrupt = true;
    throw error;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('invalid settings document');
    error.settingsDocumentCorrupt = true;
    throw error;
  }
  return normalizeSettings(parsed);
}

function temporaryPathFor(file, label = 'tmp') {
  const directory = path.dirname(file);
  return path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${temporarySequence++}.${label}`,
  );
}

function writePrivateJsonAtomic(file, value) {
  const directory = path.dirname(file);
  const temporary = temporaryPathFor(file);
  let descriptor = null;
  let commitApplied = false;
  fs.mkdirSync(directory, { recursive: true });
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, file);
    commitApplied = true;
    ensureOwnerOnly(file);
    fsyncDirectory(directory);
  } catch (error) {
    // A same-directory rename is the commit point. Callers that maintain
    // derived PAC/session state must know that a directory-fsync error happened
    // after the new JSON became visible so they can roll it back explicitly.
    if (commitApplied && error && typeof error === 'object') error.commitApplied = true;
    throw error;
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {}
  }
}

function fsyncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    // Some Windows filesystems do not allow opening directories. The file
    // itself is still fsynced before rename; directory fsync is best-effort.
    if (process.platform !== 'win32') throw error;
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function removeFileDurably(file) {
  try {
    fs.unlinkSync(file);
    fsyncDirectory(path.dirname(file));
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

function isolateCorruptSettings(file) {
  try {
    if (!fs.statSync(file).isFile()) return '';
  } catch {
    return '';
  }
  const base = `${file}.corrupt-${Date.now()}`;
  for (let index = 0; index < 100; index++) {
    const destination = index ? `${base}-${index}` : base;
    if (fs.existsSync(destination)) continue;
    try {
      fs.renameSync(file, destination);
      ensureOwnerOnly(destination);
      return destination;
    } catch {
      return '';
    }
  }
  return '';
}

function notifyRecovery(callback, detail) {
  if (typeof callback !== 'function') return;
  try { callback(detail); } catch {}
}

function loadSettings(file, { onRecovery } = {}) {
  const primaryExisted = fs.existsSync(file);
  const backupFile = `${file}${BACKUP_SUFFIX}`;
  const backupExisted = fs.existsSync(backupFile);
  let quarantined = '';
  let primaryError;
  try {
    return parseSettingsFile(file);
  } catch (error) {
    primaryError = error;
    const primaryIsRecoverable = error?.code === 'ENOENT' ||
      error?.settingsDocumentCorrupt === true;
    // A backup is only a recovery source when the primary is provably absent
    // or structurally invalid. A transient primary EIO/EACCES must not let an
    // older (or merely same-state-at-last-save) backup overwrite the still
    // authoritative primary.
    if (!primaryIsRecoverable) throw error;
    if (error.settingsDocumentCorrupt && fs.existsSync(file)) {
      quarantined = isolateCorruptSettings(file);
    }
    try {
      // parseSettingsFile already migrates a genuinely legacy document (one
      // without proxySecurityVersion) to strict authentication. Preserve an
      // explicit current-version compatibility choice, though: changing it
      // during a runtime recovery would make UI/PAC say HTTP-auth while the
      // already-running engine still exposes the selected SOCKS contract.
      const restored = parseSettingsFile(backupFile);
      try { writePrivateJsonAtomic(file, restored); } catch {}
      try { writePrivateJsonAtomic(backupFile, restored); } catch {}
      notifyRecovery(onRecovery, { kind: 'restored', quarantined: Boolean(quarantined) });
      return restored;
    } catch (backupError) {
      const backupIsKnownEmpty = backupError?.code === 'ENOENT' ||
        backupError?.settingsDocumentCorrupt === true;
      // A transient read/permission failure is not evidence that settings are
      // empty. Propagate it so no caller can save defaults over an unread but
      // authoritative account, port, routing policy, or shortcut document.
      if (!backupIsKnownEmpty) throw backupError;
      if (primaryExisted || backupExisted) {
        notifyRecovery(onRecovery, { kind: 'defaults', quarantined: Boolean(quarantined) });
      }
      return normalizeSettings(DEFAULTS);
    }
  }
}

function saveSettings(file, settings) {
  const normalized = normalizeSettings(settings);
  const backupFile = `${file}${BACKUP_SUFFIX}`;
  // Never leave a historical security state available for recovery. The
  // primary rename is still atomic; removing the old backup first means a
  // backup failure can at worst lose recovery metadata, not revive an older
  // proxy-auth or routing decision.
  if (!removeFileDurably(backupFile)) throw new Error('could not retire stale settings backup');
  writePrivateJsonAtomic(file, normalized);
  // The backup represents the same committed state, not the previous state.
  // Failure does not invalidate the primary and the next successful save will
  // recreate it.
  try { writePrivateJsonAtomic(backupFile, normalized); } catch {}
  return normalized;
}

module.exports = {
  BACKUP_SUFFIX,
  DEFAULTS,
  MAX_SETTINGS_DOCUMENT_BYTES,
  PROXY_SECURITY_VERSION,
  isolateCorruptSettings,
  isValidPort,
  loadSettings,
  normalizeSettings,
  saveSettings,
};
