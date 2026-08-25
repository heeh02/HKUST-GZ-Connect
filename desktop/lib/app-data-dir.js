'use strict';

const path = require('path');
const { assertActiveContextSwitchStartupClear } = require('./active-context-switch-startup');
const { DesktopPersistenceRuntime } = require('./desktop-persistence-runtime');
const { LegacyMigrationCredentialOwner } = require('./legacy-migration-inputs');
const { MultiSchoolStartupRuntime } = require('./multi-school-startup-runtime');
const {
  createMainProfileSwitchComposition,
} = require('./main-profile-switch-composition');
const { selectProfileWorkspacePreReadyStorage } =
  require('./profile-workspace-pre-ready-selection');
const { ProfileWorkspaceStartupRuntime } = require('./profile-workspace-startup-runtime');
const { relaunchAfterPersistenceMigration, writePersistenceE2EMarker } =
  require('./persistence-relaunch');
const { createProfileSwitchBarrierEffects } = require('./profile-switch-main-effects');
const { createMainProfileSwitchRuntime } = require('./profile-switch-main-runtime');
const { relaunchAfterProfileSwitch, scheduleProfileSwitchRelaunch,
  writeProfileSwitchE2EMarker } =
  require('./profile-switch-relaunch');
const { createLegacyRuntimeStoragePaths } = require('./runtime-storage-paths');

function resolveUserDataOverride(rawValue) {
  if (rawValue == null || String(rawValue).trim() === '') return null;
  const candidate = String(rawValue).trim();
  if (!path.isAbsolute(candidate)) {
    throw new Error('HKUSTGZ_USER_DATA_DIR must be an absolute path');
  }
  return path.resolve(candidate);
}

function createMultiSchoolStartupInitializer(options) {
  const runtime = new MultiSchoolStartupRuntime(options);
  const initialize = (persistenceRuntime, activeSchoolProfile) => runtime.initialize({
    mode: persistenceRuntime.mode,
    authority: persistenceRuntime.authority,
    withProfileDocument: (callback) => activeSchoolProfile.withProfileDocument(callback),
  });
  initialize.listViews = (viewOptions) => runtime.listViews(viewOptions);
  return Object.freeze(initialize);
}

module.exports = {
  assertActiveContextSwitchStartupClear,
  createLegacyRuntimeStoragePaths,
  createMainProfileSwitchComposition,
  createMainProfileSwitchRuntime,
  createMultiSchoolStartupInitializer,
  createProfileSwitchBarrierEffects,
  DesktopPersistenceRuntime,
  LegacyMigrationCredentialOwner,
  ProfileWorkspaceStartupRuntime,
  resolveUserDataOverride,
  relaunchAfterPersistenceMigration,
  relaunchAfterProfileSwitch,
  scheduleProfileSwitchRelaunch,
  selectProfileWorkspacePreReadyStorage,
  writePersistenceE2EMarker,
  writeProfileSwitchE2EMarker,
};
