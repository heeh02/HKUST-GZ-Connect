'use strict';

const {
  commitMigrationJournal,
  destinationReceiptDigest,
  legacySourceReceiptDigest,
  validateMigrationJournal,
} = require('./profile-workspace-migration-journal');
const {
  createProfileAccountWorkspaceLayout,
  validateUserDataRoot,
} = require('./profile-workspace-layout');

function result(ok, status, authority, code = null) {
  const value = { ok, status, authority };
  if (code !== null) value.code = code;
  return Object.freeze(value);
}

function bool(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must return a boolean`);
  return value;
}

function synchronous(value, name) {
  if (value && typeof value.then === 'function') {
    throw new TypeError(`${name} must be synchronous`);
  }
  return value;
}

function sameJournal(left, right) {
  return left.state === right.state && left.migrationId === right.migrationId &&
    left.profileId === right.profileId && left.profileRevision === right.profileRevision &&
    left.profileCredentialBindingRevision === right.profileCredentialBindingRevision &&
    left.gatewayOrigin === right.gatewayOrigin && left.protocolFamily === right.protocolFamily &&
    left.accountRevision === right.accountRevision &&
    left.accountCredentialRevision === right.accountCredentialRevision &&
    left.activeContextEpoch === right.activeContextEpoch &&
    left.legacyBrowserPartition === right.legacyBrowserPartition &&
    left.createdAt === right.createdAt &&
    left.sourceSetSha256 === right.sourceSetSha256 &&
    JSON.stringify(left.identity) === JSON.stringify(right.identity);
}

class ProfileWorkspaceMigrationCoordinator {
  constructor({
    userData,
    journalStore,
    legacyAuthorityExists,
    destinationAuthorityExists,
    collectSourceReceipts,
    prepareJournal,
    buildDestination,
    verifyDestination,
    retireLegacy,
    now = Date.now,
  } = {}) {
    if (!journalStore || typeof journalStore.read !== 'function' ||
        typeof journalStore.prepare !== 'function' || typeof journalStore.commit !== 'function' ||
        typeof journalStore.clearCommitted !== 'function' ||
        [legacyAuthorityExists, destinationAuthorityExists, collectSourceReceipts, prepareJournal,
          buildDestination, verifyDestination, retireLegacy, now]
          .some((entry) => typeof entry !== 'function')) {
      throw new TypeError('migration coordinator dependencies are incomplete');
    }
    this.userData = validateUserDataRoot(userData);
    this.journalStore = journalStore;
    this.legacyAuthorityExists = legacyAuthorityExists;
    this.destinationAuthorityExists = destinationAuthorityExists;
    this.collectSourceReceipts = collectSourceReceipts;
    this.prepareJournal = prepareJournal;
    this.buildDestination = buildDestination;
    this.verifyDestination = verifyDestination;
    this.retireLegacy = retireLegacy;
    this.now = now;
    this.running = false;
  }

  run() {
    if (this.running) {
      return result(false, 'blocked', 'none', 'MIGRATION_ALREADY_RUNNING');
    }
    this.running = true;
    try {
      return this.#runOnce();
    } finally {
      this.running = false;
    }
  }

  #runOnce() {
    let journal = synchronous(this.journalStore.read(), 'journal read');
    if (journal === null) {
      const legacy = bool(
        synchronous(this.legacyAuthorityExists(), 'legacy authority inspection'),
        'legacy authority inspection',
      );
      const destination = bool(
        synchronous(this.destinationAuthorityExists(), 'destination authority inspection'),
        'destination authority inspection',
      );
      if (legacy && destination) {
        return result(false, 'blocked', 'none', 'AMBIGUOUS_AUTHORITY');
      }
      if (destination) return result(true, 'already_migrated', 'destination');
      if (!legacy) return result(false, 'not_applicable', 'none');

      const sourceReceipts = synchronous(
        this.collectSourceReceipts(),
        'legacy source receipt collection',
      );
      journal = validateMigrationJournal(synchronous(
        this.prepareJournal(sourceReceipts),
        'migration journal preparation',
      ));
      if (journal.state !== 'prepared' ||
          legacySourceReceiptDigest(sourceReceipts) !== journal.sourceSetSha256) {
        throw new Error('prepared migration journal does not bind the observed legacy sources');
      }
      const prepared = synchronous(this.journalStore.prepare(journal), 'journal persistence');
      if (!prepared || prepared.prepared !== true) {
        throw new Error('migration journal was not prepared');
      }
      if (prepared.durabilityUnconfirmed === true) {
        const observed = validateMigrationJournal(synchronous(
          this.journalStore.read(),
          'journal confirmation read',
        ));
        if (!sameJournal(journal, observed)) {
          throw new Error('prepared migration journal durability is unconfirmed');
        }
        journal = observed;
      }
    } else {
      journal = validateMigrationJournal(journal);
    }

    const layout = createProfileAccountWorkspaceLayout({
      userData: this.userData,
      profileKey: journal.identity.profileKey,
      accountKey: journal.identity.accountKey,
      workspaceKey: journal.identity.workspaceKey,
      adoptLegacyHkustBrowserPartition: true,
    });

    if (journal.state === 'prepared') {
      if (!bool(synchronous(this.legacyAuthorityExists(), 'legacy authority inspection'),
        'legacy authority inspection')) {
        return result(false, 'blocked', 'none', 'LEGACY_AUTHORITY_MISSING');
      }
      const observedSources = synchronous(
        this.collectSourceReceipts(),
        'legacy source receipt collection',
      );
      if (legacySourceReceiptDigest(observedSources) !== journal.sourceSetSha256) {
        return result(false, 'blocked', 'legacy', 'LEGACY_SOURCE_CHANGED');
      }
      const destinationReceipts = synchronous(
        this.buildDestination(Object.freeze({ journal, layout })),
        'destination build',
      );
      const committed = commitMigrationJournal(journal, {
        destinationReceipts,
        now: this.now,
      });
      const commitResult = synchronous(
        this.journalStore.commit(committed),
        'journal commit',
      );
      if (!commitResult || commitResult.committed !== true) {
        throw new Error('migration journal was not committed');
      }
      if (commitResult.durabilityUnconfirmed === true) {
        const observed = validateMigrationJournal(synchronous(
          this.journalStore.read(),
          'journal confirmation read',
        ));
        if (!sameJournal(committed, observed) ||
            observed.destinationSetSha256 !== committed.destinationSetSha256) {
          throw new Error('committed migration journal durability is unconfirmed');
        }
        journal = observed;
      } else {
        journal = committed;
      }
    }

    if (!bool(synchronous(this.destinationAuthorityExists(), 'destination authority inspection'),
      'destination authority inspection')) {
      return result(false, 'blocked', 'destination', 'DESTINATION_MISSING');
    }
    const observedDestination = synchronous(
      this.verifyDestination(Object.freeze({ journal, layout })),
      'destination verification',
    );
    if (destinationReceiptDigest(observedDestination) !== journal.destinationSetSha256) {
      return result(false, 'blocked', 'destination', 'DESTINATION_CHANGED');
    }
    if (synchronous(
      this.retireLegacy(Object.freeze({ journal, layout })),
      'legacy retirement',
    ) !== true || bool(synchronous(this.legacyAuthorityExists(), 'legacy authority inspection'),
      'legacy authority inspection')) {
      return result(false, 'blocked', 'destination', 'LEGACY_RETIREMENT_UNCONFIRMED');
    }
    if (!bool(synchronous(this.destinationAuthorityExists(), 'destination authority inspection'),
      'destination authority inspection')) {
      return result(false, 'blocked', 'none', 'DESTINATION_MISSING');
    }
    if (synchronous(this.journalStore.clearCommitted(), 'journal clear') !== true) {
      throw new Error('committed migration journal was not cleared');
    }
    return result(true, 'migrated', 'destination');
  }
}

module.exports = { ProfileWorkspaceMigrationCoordinator };
