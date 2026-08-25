'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  OPENSSH_INCLUDE_BLOCK,
  assertOpenSshMainTarget,
  installOpenSshInclude,
  installOpenSshProfile,
  openSshManagedBlockDigest,
  openSshProfileTarget,
  removeOpenSshInclude,
  removeOpenSshProfile,
  validateOpenSshMainSource,
  validateOpenSshProfileSource,
  validateOpenSshRemovedSource,
} = require('./openssh-managed-config');
const {
  readManagedRegularFile,
} = require('./managed-file-transaction');

const ADAPTER_ID = 'openssh_proxy_command';
const INCLUDE_BLOCK_ID = OPENSSH_INCLUDE_BLOCK.blockId;

function readText(file, platform, fileSystem, missing = false) {
  const data = readManagedRegularFile(file, { platform, fileSystem, missing });
  if (data === null) return '';
  try {
    const text = data.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(data) || text.includes('\0')) {
      throw new Error('OpenSSH config is not bounded UTF-8');
    }
    return text;
  } finally { data.fill(0); }
}

function recordFor(records, profileId, blockId) {
  return records.find((record) => record.adapterId === ADAPTER_ID &&
    record.profileId === profileId && record.managedBlockId === blockId) || null;
}

class OpenSshManagedCoordinator {
  constructor({
    fileTransaction,
    recordStore,
    transactionOwner,
    helperPath,
    credentialFile,
    now = Date.now,
    platform = process.platform,
    fileSystem = fs,
  } = {}) {
    if (!fileTransaction || typeof fileTransaction.inspect !== 'function' ||
        typeof fileTransaction.inspectRemoval !== 'function' ||
        !recordStore || typeof recordStore.read !== 'function' ||
        typeof recordStore.planUpserts !== 'function' ||
        !transactionOwner || typeof transactionOwner.prepare !== 'function' ||
        typeof transactionOwner.confirm !== 'function' ||
        typeof helperPath !== 'string' || !helperPath || typeof credentialFile !== 'string' ||
        !credentialFile || typeof now !== 'function') {
      throw new TypeError('OpenSSH managed coordinator dependencies are invalid');
    }
    Object.assign(this, {
      fileTransaction, recordStore, transactionOwner, helperPath, credentialFile,
      now, platform, fileSystem,
    });
  }

  prepareInstall({ context, mainConfigFile: mainValue } = {}) {
    const mainConfigFile = assertOpenSshMainTarget(mainValue);
    const binding = context.bindingFor(ADAPTER_ID, 1);
    const profileBlockId = `openssh-profile-${binding.profileId}`;
    const profileConfigFile = openSshProfileTarget(mainConfigFile, binding.profileId);
    const records = this.recordStore.read().records;
    const includeRecord = recordFor(records, binding.profileId, INCLUDE_BLOCK_ID);
    const profileRecord = recordFor(records, binding.profileId, profileBlockId);
    for (const [record, target] of [
      [includeRecord, mainConfigFile], [profileRecord, profileConfigFile],
    ]) {
      if (record && record.targetFile !== target) {
        const error = new Error('OpenSSH managed target changed');
        error.code = 'INTEGRATION_EXPORT_CONFLICT';
        throw error;
      }
    }
    const options = {
      networkRules: context.networkRules,
      helperPath: this.helperPath,
      credentialFile: this.credentialFile,
    };
    const mainOriginal = readText(mainConfigFile, this.platform, this.fileSystem, true);
    const profileOriginal = readText(profileConfigFile, this.platform, this.fileSystem, true);
    const include = installOpenSshInclude(mainOriginal);
    if (!include.owned && includeRecord) {
      const error = new Error('owned OpenSSH Include was replaced by unowned content');
      error.code = 'INTEGRATION_TARGET_CHANGED';
      throw error;
    }
    const profileCandidate = installOpenSshProfile(profileOriginal, options);
    const mainPayload = Buffer.from(include.source, 'utf8');
    const profilePayload = Buffer.from(profileCandidate, 'utf8');
    let fileMutations;
    try {
      fileMutations = [
        {
          plan: this.fileTransaction.inspect(mainConfigFile, mainPayload),
          payload: mainPayload,
          validate: (value) => validateOpenSshMainSource(value.toString('utf8')),
        },
        {
          plan: this.fileTransaction.inspect(profileConfigFile, profilePayload, {
            ownedParentRoot: path.dirname(profileConfigFile),
          }),
          payload: profilePayload,
          validate: (value) => validateOpenSshProfileSource(value.toString('utf8'), options),
        },
      ];
    } catch (error) {
      mainPayload.fill(0); profilePayload.fill(0); throw error;
    }
    const nextRecords = [this.#record({
      previous: profileRecord,
      binding,
      targetFile: profileConfigFile,
      blockId: profileBlockId,
      installedDigest: openSshManagedBlockDigest(profileCandidate, profileBlockId),
    })];
    if (include.owned) nextRecords.push(this.#record({
      previous: includeRecord,
      binding,
      targetFile: mainConfigFile,
      blockId: INCLUDE_BLOCK_ID,
      installedDigest: openSshManagedBlockDigest(include.source, INCLUDE_BLOCK_ID),
    }));
    let recordPlan;
    try { recordPlan = this.recordStore.planUpserts(nextRecords); }
    catch (error) { mainPayload.fill(0); profilePayload.fill(0); throw error; }
    return this.transactionOwner.prepare({
      adapterId: ADAPTER_ID,
      action: profileRecord ? 'update' : 'install',
      binding,
      fileMutations,
      recordPlan,
      warningCodes: [
        'INTEGRATION_CREDENTIAL_SIDECAR_PRIVATE',
        'INTEGRATION_CLIENT_ACTIVATION_UNVERIFIED',
      ],
    });
  }

  prepareRemove({ context } = {}) {
    const binding = context.bindingFor(ADAPTER_ID, 1);
    const profileBlockId = `openssh-profile-${binding.profileId}`;
    const records = this.recordStore.read().records;
    const profileRecord = recordFor(records, binding.profileId, profileBlockId);
    const includeRecord = recordFor(records, binding.profileId, INCLUDE_BLOCK_ID);
    if (!profileRecord) {
      const error = new Error('managed OpenSSH Profile record is unavailable');
      error.code = 'INTEGRATION_ADAPTER_UNAVAILABLE';
      throw error;
    }
    const profileOriginal = readText(
      profileRecord.targetFile, this.platform, this.fileSystem,
    );
    if (openSshManagedBlockDigest(profileOriginal, profileBlockId) !==
        profileRecord.installedDigest) {
      const error = new Error('managed OpenSSH Profile block changed');
      error.code = 'INTEGRATION_TARGET_CHANGED';
      throw error;
    }
    const fileMutations = [];
    const buffers = [];
    const profileCandidate = removeOpenSshProfile(profileOriginal, binding.profileId);
    if (profileCandidate.trim()) {
      const payload = Buffer.from(profileCandidate, 'utf8'); buffers.push(payload);
      fileMutations.push({
        plan: this.fileTransaction.inspect(profileRecord.targetFile, payload),
        payload,
        validate: (value) => validateOpenSshRemovedSource(value.toString('utf8'), profileBlockId),
      });
    } else {
      fileMutations.push({
        plan: this.fileTransaction.inspectRemoval(profileRecord.targetFile, {
          removeEmptyOwnedParent: path.dirname(profileRecord.targetFile),
        }),
        payload: null,
        validate: () => true,
      });
    }
    const removedRecords = [profileRecord];
    if (includeRecord) {
      const mainOriginal = readText(includeRecord.targetFile, this.platform, this.fileSystem);
      if (openSshManagedBlockDigest(mainOriginal, INCLUDE_BLOCK_ID) !== includeRecord.installedDigest) {
        for (const payload of buffers) payload.fill(0);
        const error = new Error('managed OpenSSH Include block changed');
        error.code = 'INTEGRATION_TARGET_CHANGED';
        throw error;
      }
      const mainCandidate = removeOpenSshInclude(mainOriginal);
      if (mainCandidate.trim()) {
        const payload = Buffer.from(mainCandidate, 'utf8'); buffers.push(payload);
        fileMutations.push({
          plan: this.fileTransaction.inspect(includeRecord.targetFile, payload),
          payload,
          validate: (value) => validateOpenSshRemovedSource(
            value.toString('utf8'), INCLUDE_BLOCK_ID,
          ),
        });
      } else {
        fileMutations.push({
          plan: this.fileTransaction.inspectRemoval(includeRecord.targetFile),
          payload: null,
          validate: () => true,
        });
      }
      removedRecords.push(includeRecord);
    }
    let recordPlan;
    try { recordPlan = this.recordStore.planRemovals(removedRecords); }
    catch (error) { for (const payload of buffers) payload.fill(0); throw error; }
    return this.transactionOwner.prepare({
      adapterId: ADAPTER_ID,
      action: 'remove',
      binding,
      fileMutations,
      recordPlan,
      warningCodes: ['INTEGRATION_CLIENT_ACTIVATION_UNVERIFIED'],
    });
  }

  confirm({ confirmationHandle, context } = {}) {
    return this.transactionOwner.confirm({
      confirmationHandle,
      currentBinding: context.bindingFor(ADAPTER_ID, 1),
    });
  }

  cancel() { return this.transactionOwner.cancel(); }

  #record({ previous, binding, targetFile, blockId, installedDigest }) {
    return {
      schemaVersion: 1,
      adapterId: ADAPTER_ID,
      adapterVersion: 1,
      profileId: binding.profileId,
      bindingDigest: binding.bindingDigest,
      targetFile,
      installedRevision: (previous?.installedRevision || 0) + 1,
      installedDigest,
      managedBlockId: blockId,
      backupReference: null,
      updatedAt: this.now(),
    };
  }
}

module.exports = { OpenSshManagedCoordinator };
