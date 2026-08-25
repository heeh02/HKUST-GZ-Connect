'use strict';

const vm = require('node:vm');
const {
  assertClashVergeScriptTarget,
  clashVergeManagedBlockDigest,
  installClashVergeManagedScript,
  removeClashVergeManagedScript,
  validateClashVergeManagedScript,
  validateClashVergeScriptWithoutManagedBlock,
} = require('./clash-verge-script');
const {
  readManagedRegularFile,
} = require('./managed-file-transaction');

const ADAPTER_ID = 'clash_verge_rev_managed';
const BLOCK_ID = 'clash-verge-rev';

function sourceText(file, platform, fileSystem) {
  const data = readManagedRegularFile(file, { platform, fileSystem });
  try {
    const text = data.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(data)) throw new Error('Script.js is not UTF-8');
    new vm.Script(text, { filename: 'Script.js' });
    return text;
  } finally { data.fill(0); }
}

function matchingRecord(records, profileId) {
  return records.find((record) => record.adapterId === ADAPTER_ID &&
    record.profileId === profileId && record.managedBlockId === BLOCK_ID) || null;
}

class ClashVergeManagedCoordinator {
  constructor({
    fileTransaction,
    recordStore,
    transactionOwner,
    helper = {},
    now = Date.now,
    platform = process.platform,
    fileSystem,
  } = {}) {
    if (!fileTransaction || typeof fileTransaction.inspect !== 'function' ||
        !recordStore || typeof recordStore.read !== 'function' ||
        typeof recordStore.planUpsert !== 'function' ||
        !transactionOwner || typeof transactionOwner.prepare !== 'function' ||
        typeof transactionOwner.confirm !== 'function' || typeof now !== 'function') {
      throw new TypeError('Clash Verge managed coordinator dependencies are invalid');
    }
    Object.assign(this, {
      fileTransaction, recordStore, transactionOwner, now, platform,
      fileSystem: fileSystem || require('node:fs'), helper,
    });
  }

  prepareInstall({ context, targetFile: targetValue } = {}) {
    const targetFile = assertClashVergeScriptTarget(targetValue);
    const binding = context.bindingFor(ADAPTER_ID, 1);
    const records = this.recordStore.read().records;
    const previous = matchingRecord(records, binding.profileId);
    if (previous && previous.targetFile !== targetFile) {
      const error = new Error('managed Clash Verge target changed');
      error.code = 'INTEGRATION_EXPORT_CONFLICT';
      throw error;
    }
    const original = sourceText(targetFile, this.platform, this.fileSystem);
    const options = {
      port: context.port,
      credential: context.credential,
      networkRules: context.networkRules,
    };
    const candidate = installClashVergeManagedScript(original, options);
    const payload = Buffer.from(candidate, 'utf8');
    const plan = this.fileTransaction.inspect(targetFile, payload);
    const installedDigest = clashVergeManagedBlockDigest(candidate);
    const record = {
      schemaVersion: 1,
      adapterId: ADAPTER_ID,
      adapterVersion: 1,
      profileId: binding.profileId,
      bindingDigest: binding.bindingDigest,
      targetFile,
      installedRevision: (previous?.installedRevision || 0) + 1,
      installedDigest,
      managedBlockId: BLOCK_ID,
      backupReference: null,
      updatedAt: this.now(),
    };
    let recordPlan;
    try { recordPlan = this.recordStore.planUpsert(record); }
    catch (error) { payload.fill(0); throw error; }
    return this.transactionOwner.prepare({
      adapterId: ADAPTER_ID,
      action: previous ? 'update' : 'install',
      binding,
      fileMutations: [{
        plan,
        payload,
        validate: (value) => validateClashVergeManagedScript(value.toString('utf8'), options),
      }],
      recordPlan,
      containsLocalProxyCredential: true,
      warningCodes: [
        'INTEGRATION_LOCAL_CREDENTIAL_PRIVATE',
        'INTEGRATION_CLIENT_ACTIVATION_UNVERIFIED',
      ],
    });
  }

  prepareRemove({ context } = {}) {
    const binding = context.bindingFor(ADAPTER_ID, 1);
    const records = this.recordStore.read().records;
    const previous = matchingRecord(records, binding.profileId);
    if (!previous) {
      const error = new Error('managed Clash Verge record is unavailable');
      error.code = 'INTEGRATION_ADAPTER_UNAVAILABLE';
      throw error;
    }
    const original = sourceText(previous.targetFile, this.platform, this.fileSystem);
    if (clashVergeManagedBlockDigest(original) !== previous.installedDigest) {
      const error = new Error('managed Clash Verge block changed');
      error.code = 'INTEGRATION_TARGET_CHANGED';
      throw error;
    }
    const candidate = removeClashVergeManagedScript(original);
    const payload = Buffer.from(candidate, 'utf8');
    let recordPlan;
    try { recordPlan = this.recordStore.planRemove(previous); }
    catch (error) { payload.fill(0); throw error; }
    return this.transactionOwner.prepare({
      adapterId: ADAPTER_ID,
      action: 'remove',
      binding,
      fileMutations: [{
        plan: this.fileTransaction.inspect(previous.targetFile, payload),
        payload,
        validate: (value) => validateClashVergeScriptWithoutManagedBlock(value.toString('utf8')),
      }],
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
}

module.exports = { ClashVergeManagedCoordinator };
