'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createHkustMigrationDestinationPlan, LEGACY_COPY_SOURCE_IDS } =
  require('./hkust-migration-destination-plan');
const {
  openLegacyMigrationCredential,
  readLegacyMigrationPayloads,
} = require('./legacy-migration-inputs');
const {
  collectLegacyFlatSourceReceipts,
} = require('./legacy-flat-source-receipts');
const { retireLegacyFlatSources } = require('./legacy-flat-source-retirement');
const {
  destinationPathMap,
  materializeDestinationFiles,
  verifyDestinationFiles,
} = require('./profile-workspace-destination-files');
const {
  createPreparedMigrationJournal,
  LEGACY_SOURCE_IDS,
} = require('./profile-workspace-migration-journal');
const { ProfileWorkspaceMigrationCoordinator } =
  require('./profile-workspace-migration-coordinator');
const { ProfileWorkspaceMigrationJournalStore } =
  require('./profile-workspace-migration-store');
const {
  loadActiveProfileWorkspaceAuthority,
} = require('./profile-workspace-runtime-authority');
const { validateUserDataRoot } = require('./profile-workspace-layout');
const {
  createLegacyRuntimeStoragePaths,
  createProfileWorkspaceRuntimeStoragePaths,
} = require('./runtime-storage-paths');
const { validateSchoolProfileDocument } = require('./profiles/schema/school-profile-schema');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('./windows-private-file');

function pathExists(file, fileSystem) {
  try {
    fileSystem.lstatSync(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function exactPayloads(payloads) {
  return Object.freeze(Object.fromEntries(LEGACY_COPY_SOURCE_IDS.map((id) => [id, payloads[id]])));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function cloneProfileDocument(value) {
  let cloned;
  try { cloned = JSON.parse(JSON.stringify(value)); }
  catch (error) { throw new TypeError('SchoolProfile document could not be cloned', { cause: error }); }
  validateSchoolProfileDocument(cloned);
  return deepFreeze(cloned);
}

class ProfileWorkspaceMigrationRuntime {
  constructor({
    userData,
    profile: rawProfile,
    safeStorage,
    fileSystem = fs,
    platform = process.platform,
    windowsAcl = {
      protect: protectWindowsFileOwnerOnly,
      verify: verifyWindowsFileOwnerOnly,
    },
    randomBytes = crypto.randomBytes,
    now = Date.now,
  } = {}) {
    if (!safeStorage || !fileSystem || typeof fileSystem.openSync !== 'function' ||
        !['darwin', 'linux', 'win32'].includes(platform) ||
        (platform === 'win32' &&
          (typeof windowsAcl?.protect !== 'function' || typeof windowsAcl?.verify !== 'function')) ||
        typeof randomBytes !== 'function' || typeof now !== 'function') {
      throw new TypeError('Profile Workspace migration runtime dependencies are invalid');
    }
    this.userData = validateUserDataRoot(userData);
    this.profileDocument = cloneProfileDocument(rawProfile);
    this.profile = validateSchoolProfileDocument(this.profileDocument);
    this.safeStorage = safeStorage;
    this.fileSystem = fileSystem;
    this.platform = platform;
    this.windowsAcl = windowsAcl;
    this.randomBytes = randomBytes;
    this.now = now;
    this.running = false;
    this.journalPath = path.join(
      this.userData,
      'global',
      'profile-account-workspace-migration.json',
    );
  }

  run() {
    if (this.running) throw new Error('Profile Workspace migration runtime is already running');
    this.running = true;
    try {
      const coordinator = this.#coordinator();
      const migration = coordinator.run();
      if (!migration.ok && migration.status === 'blocked') {
        const error = new Error('Profile Workspace migration is blocked');
        error.code = migration.code;
        throw error;
      }
      if (['migrated', 'already_migrated'].includes(migration.status)) {
        const authority = this.#loadAuthority();
        return Object.freeze({
          migration,
          mode: 'profile-workspace',
          authority,
          paths: createProfileWorkspaceRuntimeStoragePaths(authority),
        });
      }
      return Object.freeze({
        migration,
        mode: 'legacy-flat',
        authority: null,
        paths: createLegacyRuntimeStoragePaths(this.userData),
      });
    } finally {
      this.running = false;
    }
  }

  #coordinator() {
    const journalStore = new ProfileWorkspaceMigrationJournalStore({
      filePath: this.journalPath,
      fileSystem: this.fileSystem,
      platform: this.platform,
      windowsAcl: this.windowsAcl,
    });
    return new ProfileWorkspaceMigrationCoordinator({
      userData: this.userData,
      journalStore,
      legacyAuthorityExists: () => this.#legacyAuthorityExists(),
      destinationAuthorityExists: (context) => this.#destinationAuthorityExists(context),
      collectSourceReceipts: () => this.#sourceReceipts(),
      prepareJournal: (sourceReceipts) => createPreparedMigrationJournal({
        profileId: this.profile.profileId,
        profileRevision: this.profile.profileRevision,
        profileCredentialBindingRevision: this.profile.profileCredentialBindingRevision,
        gatewayOrigin: this.profile.gateway.origin.origin,
        protocolFamily: this.profile.gateway.protocolFamily,
        sourceReceipts,
        randomBytes: this.randomBytes,
        now: this.now,
      }),
      buildDestination: ({ journal, layout }) => this.#buildDestination(journal, layout),
      verifyDestination: ({ layout }) => verifyDestinationFiles({
        layout,
        fileSystem: this.fileSystem,
        platform: this.platform,
        windowsAcl: this.windowsAcl,
      }),
      retireLegacy: ({ journal }) => retireLegacyFlatSources({
        userData: this.userData,
        expectedReceipts: journal.sourceReceipts,
        fileSystem: this.fileSystem,
        platform: this.platform,
        windowsAcl: this.windowsAcl,
      }),
      now: this.now,
    });
  }

  #sourceReceipts() {
    return collectLegacyFlatSourceReceipts({
      userData: this.userData,
      fileSystem: this.fileSystem,
      platform: this.platform,
      windowsAcl: this.windowsAcl,
    });
  }

  #legacyAuthorityExists() {
    const receipts = this.#sourceReceipts();
    if (receipts.settings.present) return true;
    if (LEGACY_SOURCE_IDS.some((id) => receipts[id].present)) {
      throw new Error('orphaned legacy storage exists without settings authority');
    }
    return false;
  }

  #destinationAuthorityExists(context) {
    if (context?.layout) {
      return verifyDestinationFiles({
        layout: context.layout,
        fileSystem: this.fileSystem,
        platform: this.platform,
        windowsAcl: this.windowsAcl,
      }).globalSettings.present;
    }
    const globalSettings = path.join(this.userData, 'global', 'settings.json');
    if (!pathExists(globalSettings, this.fileSystem)) return false;
    this.#loadAuthority();
    return true;
  }

  #buildDestination(journal, layout) {
    const owner = readLegacyMigrationPayloads({
      userData: this.userData,
      expectedReceipts: journal.sourceReceipts,
      fileSystem: this.fileSystem,
      platform: this.platform,
      windowsAcl: this.windowsAcl,
    });
    try {
      return owner.withPayloads((payloads) => {
        const credentialOwner = openLegacyMigrationCredential({
          settingsBytes: payloads.settings,
          encryptedCredential: payloads.vpnCredential,
          safeStorage: this.safeStorage,
          platform: this.platform,
        });
        let plan = null;
        try {
          plan = createHkustMigrationDestinationPlan({
            journal,
            settingsBytes: payloads.settings,
            legacyCredential: payloads.vpnCredential,
            payloads: exactPayloads(payloads),
            credentialOwner,
            protectedStorage: this.safeStorage,
            platform: this.platform,
            now: this.now,
          });
          return materializeDestinationFiles({
            layout,
            files: plan.files,
            fileSystem: this.fileSystem,
            platform: this.platform,
            windowsAcl: this.windowsAcl,
          });
        } finally {
          credentialOwner?.destroy();
          for (const data of Object.values(plan?.files || {})) data?.fill?.(0);
        }
      });
    } finally {
      owner.destroy();
    }
  }

  #loadAuthority() {
    return loadActiveProfileWorkspaceAuthority({
      userData: this.userData,
      profile: this.profileDocument,
      fileSystem: this.fileSystem,
      platform: this.platform,
      windowsAcl: this.windowsAcl,
    });
  }
}

module.exports = { ProfileWorkspaceMigrationRuntime };
