'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('./credential-store');
const {
  collectPrivateFileReceipt,
} = require('./legacy-flat-source-receipts');
const { DESTINATION_RECEIPT_IDS } = require('./profile-workspace-migration-journal');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('./windows-private-file');

const MAX_DESTINATION_FILE_BYTES = 16 * 1024 * 1024;

function destinationPathMap(layout) {
  if (!layout?.global || !layout?.profile || !layout?.account || !layout?.workspace) {
    throw new TypeError('profile workspace layout is invalid');
  }
  const values = {
    globalSettings: layout.global.settings,
    globalProxyCredential: layout.global.proxyCredential,
    globalProxyHelperCredential: layout.global.proxyHelperCredential,
    globalEngineOwner: layout.global.engineOwner,
    globalUpdateState: layout.global.updateState,
    globalActiveContextSwitch: layout.global.activeContextSwitch,
    profileSettings: layout.profile.settings,
    profileState: layout.profile.state,
    account: layout.account.document,
    vpnCredential: layout.account.vpnCredential,
    legacyCredentialRollbackBlob: layout.account.legacyCredentialRollbackBlob,
    legacyCredentialRollbackState: layout.account.legacyCredentialRollbackState,
    legacyCredentialRollbackRetirement: layout.account.legacyCredentialRollbackRetirement,
    credentialTransaction: layout.account.credentialTransaction,
    deletionTombstone: layout.account.deletionTombstone,
    workspaceSettings: layout.workspace.settings,
    workspaceState: layout.workspace.state,
    siteCredentials: layout.workspace.siteCredentials,
    certificateTrust: layout.workspace.certificateTrust,
    routingRules: layout.workspace.routingRules,
    externalPac: layout.workspace.externalPac,
    browserPac: layout.workspace.browserPac,
    localResources: layout.workspace.localResources,
    favorites: layout.workspace.favorites,
    recentResources: layout.workspace.recentResources,
    externalIntegrations: layout.workspace.externalIntegrations,
    engineLog: layout.workspace.engineLog,
    engineLogRotated: layout.workspace.engineLogRotated,
    engineLogRetention: layout.workspace.engineLogRetention,
  };
  if (DESTINATION_RECEIPT_IDS.some((id) => typeof values[id] !== 'string') ||
      Object.keys(values).length !== DESTINATION_RECEIPT_IDS.length ||
      new Set(Object.values(values)).size !== DESTINATION_RECEIPT_IDS.length) {
    throw new TypeError('destination path map does not match the journal schema');
  }
  const root = layout.root;
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root ||
      Object.values(values).some((file) => {
        if (!path.isAbsolute(file) || path.resolve(file) !== file) return true;
        const relative = path.relative(root, file);
        return !relative || relative === '..' || relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative);
      })) {
    throw new TypeError('destination path escapes the profile workspace root');
  }
  return Object.freeze(Object.fromEntries(DESTINATION_RECEIPT_IDS.map((id) => [id, values[id]])));
}

function exactFilePlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('destination file plan must be a plain object');
  }
  const keys = Object.keys(value).sort();
  const expected = [...DESTINATION_RECEIPT_IDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError('destination file plan does not match the journal schema');
  }
  for (const id of DESTINATION_RECEIPT_IDS) {
    if (value[id] !== null && (!Buffer.isBuffer(value[id]) || value[id].length < 1 ||
        value[id].length > MAX_DESTINATION_FILE_BYTES)) {
      throw new TypeError(`destination file ${id} is invalid`);
    }
  }
  return value;
}

function receiptFor(file, { fileSystem, platform, windowsAcl }) {
  return collectPrivateFileReceipt({
    file,
    maxBytes: MAX_DESTINATION_FILE_BYTES,
    fileSystem,
    platform,
    windowsAcl,
    label: 'destination file',
  });
}

function expectedReceipt(data) {
  if (data === null) return Object.freeze({ present: false, bytes: 0, sha256: null });
  return Object.freeze({
    present: true,
    bytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
  });
}

function sameReceipt(left, right) {
  return left.present === right.present && left.bytes === right.bytes && left.sha256 === right.sha256;
}

function fsyncDirectory(directory, fileSystem, platform) {
  let descriptor = null;
  try {
    descriptor = fileSystem.openSync(directory, 'r');
    fileSystem.fsyncSync?.(descriptor);
    return true;
  } catch {
    return platform === 'win32';
  } finally {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
  }
}

function verifyDirectoryChain(root, directory, deps, { create = false } = {}) {
  const relative = path.relative(root, directory);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('destination directory escapes the workspace root');
  }
  let rootStat;
  try {
    rootStat = deps.fileSystem.lstatSync(root);
  } catch (error) {
    throw new Error('destination root is unavailable', { cause: error });
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('destination root is not a trusted directory');
  }
  let current = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try {
      stat = deps.fileSystem.lstatSync(current);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (!create) return false;
      try {
        deps.fileSystem.mkdirSync(current, { mode: 0o700 });
        stat = deps.fileSystem.lstatSync(current);
      } catch (mkdirError) {
        throw new Error('destination directory creation failed', { cause: mkdirError });
      }
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        (deps.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
      throw new Error('destination directory is not owner-only and link-free');
    }
  }
  return true;
}

function storageOptions(platform, windowsAcl) {
  return platform === 'win32' ? {
    protectTemporary: (temporary) => windowsAcl.protect(temporary) === true,
    verifyCommitted: (committed) => windowsAcl.verify(committed) === true,
    removeCommittedOnFailure: true,
  } : {};
}

function dependencies({ fileSystem = fs, platform = process.platform, windowsAcl = {
  protect: protectWindowsFileOwnerOnly,
  verify: verifyWindowsFileOwnerOnly,
} } = {}) {
  if (!fileSystem || typeof fileSystem.openSync !== 'function' ||
      !['darwin', 'linux', 'win32'].includes(platform) ||
      (platform === 'win32' &&
        (typeof windowsAcl?.protect !== 'function' || typeof windowsAcl?.verify !== 'function'))) {
    throw new TypeError('destination file dependencies are invalid');
  }
  return { fileSystem, platform, windowsAcl };
}

function verifyDestinationFiles({ layout, fileSystem, platform, windowsAcl } = {}) {
  const deps = dependencies({ fileSystem, platform, windowsAcl });
  const paths = destinationPathMap(layout);
  return Object.freeze(Object.fromEntries(DESTINATION_RECEIPT_IDS.map((id) => [
    id,
    verifyDirectoryChain(layout.root, path.dirname(paths[id]), deps)
      ? receiptFor(paths[id], deps)
      : Object.freeze({ present: false, bytes: 0, sha256: null }),
  ])));
}

function materializeDestinationFiles({ layout, files, fileSystem, platform, windowsAcl } = {}) {
  const deps = dependencies({ fileSystem, platform, windowsAcl });
  const plan = exactFilePlan(files);
  const paths = destinationPathMap(layout);
  const expected = Object.fromEntries(DESTINATION_RECEIPT_IDS.map((id) => [
    id,
    expectedReceipt(plan[id]),
  ]));

  for (const directory of new Set(Object.values(paths).map(path.dirname))) {
    verifyDirectoryChain(layout.root, directory, deps);
  }

  // Preflight every target before the first write. Existing matching files are
  // valid idempotent recovery; any other entry blocks the whole attempt.
  const before = {};
  for (const id of DESTINATION_RECEIPT_IDS) {
    before[id] = receiptFor(paths[id], deps);
    if (before[id].present && !sameReceipt(before[id], expected[id])) {
      throw new Error(`destination file conflict: ${id}`);
    }
  }

  for (const directory of new Set(Object.values(paths).map(path.dirname))) {
    verifyDirectoryChain(layout.root, directory, deps, { create: true });
  }

  const touchedDirectories = new Set();
  for (const id of DESTINATION_RECEIPT_IDS) {
    if (plan[id] === null || before[id].present) continue;
    const file = paths[id];
    if (!atomicWritePrivateFile(
      file,
      plan[id],
      deps.fileSystem,
      storageOptions(deps.platform, deps.windowsAcl),
    )) {
      const observed = receiptFor(file, deps);
      const error = new Error(`destination file write failed: ${id}`);
      error.commitApplied = sameReceipt(observed, expected[id]);
      throw error;
    }
    touchedDirectories.add(path.dirname(file));
  }

  for (const directory of new Set(Object.values(paths).map(path.dirname))) {
    if (!fsyncDirectory(directory, deps.fileSystem, deps.platform)) {
      const error = new Error('destination directory fsync failed');
      error.commitApplied = touchedDirectories.has(directory);
      throw error;
    }
  }
  const observed = verifyDestinationFiles({ layout, ...deps });
  for (const id of DESTINATION_RECEIPT_IDS) {
    if (!sameReceipt(observed[id], expected[id])) {
      throw new Error(`destination verification failed: ${id}`);
    }
  }
  return observed;
}

module.exports = {
  MAX_DESTINATION_FILE_BYTES,
  destinationPathMap,
  materializeDestinationFiles,
  verifyDestinationFiles,
};
