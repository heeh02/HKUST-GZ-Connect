'use strict';

const path = require('path');
const { ActiveContextLease } = require('../switching/active-context/active-context-lease');
const { assertActiveContextSwitchStartupClear } = require('../switching/active-context/active-context-switch-startup');
const { DesktopPersistenceRuntime } = require('../persistence/runtime/desktop-persistence-runtime');
const { LegacyMigrationCredentialOwner } = require('../persistence/migration/legacy-hkust/legacy-migration-inputs');
const { MultiSchoolStartupRuntime } = require('./startup/multi-school-startup-runtime');
const {
  createMainProfileSwitchComposition,
} = require('../switching/effects/main-profile-switch-composition');
const { selectProfileWorkspacePreReadyStorage } =
  require('../persistence/runtime/profile-workspace-pre-ready-selection');
const { ProfileWorkspaceStartupRuntime } = require('../persistence/runtime/profile-workspace-startup-runtime');
const { relaunchAfterPersistenceMigration, writePersistenceE2EMarker } =
  require('../persistence/migration/legacy-hkust/persistence-relaunch');
const { createProfileSwitchBarrierEffects } = require('../switching/effects/profile-switch-main-effects');
const { createMainProfileSwitchRuntime } = require('../switching/runtime/profile-switch-main-runtime');
const { relaunchAfterProfileSwitch, scheduleProfileSwitchRelaunch,
  writeProfileSwitchE2EMarker } =
  require('../switching/runtime/profile-switch-relaunch');
const { createLegacyRuntimeStoragePaths } = require('../persistence/paths/runtime-storage-paths');

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

const desktopRuntimeComposition = Object.freeze({
  ActiveContextLease,
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
});

module.exports = { desktopRuntimeComposition };
