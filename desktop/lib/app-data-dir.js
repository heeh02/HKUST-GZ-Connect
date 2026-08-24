'use strict';

const path = require('path');
const { DesktopPersistenceRuntime } = require('./desktop-persistence-runtime');
const { LegacyMigrationCredentialOwner } = require('./legacy-migration-inputs');
const { selectProfileWorkspacePreReadyStorage } =
  require('./profile-workspace-pre-ready-selection');
const { ProfileWorkspaceStartupRuntime } = require('./profile-workspace-startup-runtime');
const { relaunchAfterPersistenceMigration, writePersistenceE2EMarker } =
  require('./persistence-relaunch');
const { createLegacyRuntimeStoragePaths } = require('./runtime-storage-paths');

function resolveUserDataOverride(rawValue) {
  if (rawValue == null || String(rawValue).trim() === '') return null;
  const candidate = String(rawValue).trim();
  if (!path.isAbsolute(candidate)) {
    throw new Error('HKUSTGZ_USER_DATA_DIR must be an absolute path');
  }
  return path.resolve(candidate);
}

module.exports = {
  createLegacyRuntimeStoragePaths,
  DesktopPersistenceRuntime,
  LegacyMigrationCredentialOwner,
  ProfileWorkspaceStartupRuntime,
  resolveUserDataOverride,
  relaunchAfterPersistenceMigration,
  selectProfileWorkspacePreReadyStorage,
  writePersistenceE2EMarker,
};
