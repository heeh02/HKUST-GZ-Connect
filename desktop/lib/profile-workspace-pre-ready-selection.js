'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  loadActiveProfileAccountAuthority,
} = require('./profile-workspace-runtime-authority');
const { validateUserDataRoot } = require('./profile-workspace-layout');
const {
  createLegacyRuntimeStoragePaths,
  createProfileWorkspaceRuntimeStoragePaths,
} = require('./runtime-storage-paths');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('./windows-private-file');

function exists(file, fileSystem) {
  try {
    fileSystem.lstatSync(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function selectProfileWorkspacePreReadyStorage({
  userData,
  profile,
  fileSystem = fs,
  platform = process.platform,
  windowsAcl = {
    protect: protectWindowsFileOwnerOnly,
    verify: verifyWindowsFileOwnerOnly,
  },
} = {}) {
  const root = validateUserDataRoot(userData);
  const legacy = (reason) => Object.freeze({
    mode: 'legacy-flat',
    reason,
    authority: null,
    paths: createLegacyRuntimeStoragePaths(root),
  });
  const journal = path.join(root, 'global', 'profile-account-workspace-migration.json');
  if (exists(journal, fileSystem)) return legacy('migration-recovery');
  const globalSettings = path.join(root, 'global', 'settings.json');
  if (!exists(globalSettings, fileSystem)) return legacy('no-destination');
  const authority = loadActiveProfileAccountAuthority({
    userData: root,
    profile,
    fileSystem,
    platform,
    windowsAcl,
  });
  return Object.freeze({
    mode: 'profile-workspace',
    reason: 'verified-destination',
    authority,
    paths: createProfileWorkspaceRuntimeStoragePaths(authority),
  });
}

module.exports = { selectProfileWorkspacePreReadyStorage };
