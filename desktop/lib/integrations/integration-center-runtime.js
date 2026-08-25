'use strict';

const path = require('node:path');
const {
  ClashVergeManagedCoordinator,
} = require('./clash-verge-managed-coordinator');
const {
  createGenericExportCoordinator,
} = require('./generic-export-coordinator');
const {
  IntegrationRecordStore,
} = require('./integration-record-store');
const {
  INTEGRATION_ADAPTER_IDS,
  createIntegrationAdapterView,
} = require('./integration-schema');
const {
  ManagedAdapterTransactionOwner,
} = require('./managed-adapter-transaction');
const {
  ManagedFileTransaction,
} = require('./managed-file-transaction');
const {
  OpenSshManagedCoordinator,
} = require('./openssh-managed-coordinator');

const GENERIC = new Set(['clash_yaml', 'mihomo_yaml', 'pac', 'manual_export']);
const MANAGED = new Set(['clash_verge_rev_managed', 'openssh_proxy_command']);

function integrationError(code, cause = null) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function activeManagedRecord(records, adapterId, profileId) {
  if (adapterId === 'clash_verge_rev_managed') {
    return records.find((record) => record.adapterId === adapterId &&
      record.profileId === profileId && record.managedBlockId === 'clash-verge-rev') || null;
  }
  if (adapterId === 'openssh_proxy_command') {
    return records.find((record) => record.adapterId === adapterId &&
      record.profileId === profileId &&
      record.managedBlockId === `openssh-profile-${profileId}`) || null;
  }
  return null;
}

function managedTarget(records, adapterId, profileId) {
  const record = activeManagedRecord(records, adapterId, profileId);
  if (!record) return null;
  if (adapterId !== 'openssh_proxy_command') return record.targetFile;
  const include = records.find((candidate) => candidate.adapterId === adapterId &&
    candidate.profileId === profileId && candidate.managedBlockId === 'openssh-include');
  if (include) return include.targetFile;
  return path.join(path.dirname(path.dirname(record.targetFile)), 'config');
}

class IntegrationCenterRuntime {
  constructor({
    getContext,
    selectTarget,
    ensureSidecar,
    recordStore,
    genericCoordinator,
    clashVergeCoordinator,
    openSshCoordinator,
  } = {}) {
    if (typeof getContext !== 'function' || typeof selectTarget !== 'function' ||
        typeof ensureSidecar !== 'function' || !recordStore ||
        !genericCoordinator || !clashVergeCoordinator || !openSshCoordinator) {
      throw new TypeError('Integration Center runtime dependencies are invalid');
    }
    Object.assign(this, {
      getContext, selectTarget, ensureSidecar, recordStore,
      genericCoordinator, clashVergeCoordinator, openSshCoordinator,
    });
    this.pending = null;
  }

  list() {
    let context;
    let records = [];
    try {
      context = this.getContext();
      records = this.recordStore.read().records;
    } catch (error) {
      const state = error?.code === 'INTEGRATION_AUTH_INCOMPATIBLE'
        ? 'unsupported' : 'unavailable';
      return Object.freeze(INTEGRATION_ADAPTER_IDS.map((adapterId) => (
        createIntegrationAdapterView({
          adapterId, compatibilityState: state, bindingState: 'unavailable',
        })
      )));
    }
    return Object.freeze(INTEGRATION_ADAPTER_IDS.map((adapterId) => {
      const implemented = GENERIC.has(adapterId) || MANAGED.has(adapterId);
      const record = activeManagedRecord(records, adapterId, context.networkRules.profileId);
      let bindingState = record ? 'stale' : 'not-installed';
      if (record) {
        try {
          const binding = context.bindingFor(adapterId, 1);
          if (record.bindingDigest === binding.bindingDigest) bindingState = 'current';
        } catch { bindingState = 'unavailable'; }
      }
      return createIntegrationAdapterView({
        adapterId,
        compatibilityState: implemented ? 'supported' : 'unavailable',
        bindingState,
        updatedAt: record?.updatedAt || null,
      });
    }));
  }

  async prepare({ adapterId, action } = {}) {
    this.cancel();
    if (!INTEGRATION_ADAPTER_IDS.includes(adapterId)) {
      throw integrationError('INTEGRATION_ADAPTER_UNAVAILABLE');
    }
    const context = this.getContext();
    let preview;
    if (GENERIC.has(adapterId)) {
      if (!['copy', 'save'].includes(action)) {
        throw integrationError('INTEGRATION_ADAPTER_UNAVAILABLE');
      }
      const targetFile = action === 'save'
        ? await this.#target(adapterId, action, null)
        : null;
      preview = this.genericCoordinator.prepare({
        adapterId,
        action,
        binding: context.bindingFor(adapterId, 1),
        networkRules: context.networkRules,
        port: context.port,
        credential: adapterId === 'pac' ? null : context.credential,
        pacSource: adapterId === 'pac' ? context.pacSource : null,
        targetFile,
      });
      this.pending = { kind: 'generic', adapterId };
      return preview;
    }
    if (!MANAGED.has(adapterId)) throw integrationError('INTEGRATION_ADAPTER_UNAVAILABLE');
    const records = this.recordStore.read().records;
    const coordinator = adapterId === 'clash_verge_rev_managed'
      ? this.clashVergeCoordinator : this.openSshCoordinator;
    if (action === 'remove') {
      preview = coordinator.prepareRemove({ context });
    } else if (action === 'install' || action === 'update') {
      const targetFile = managedTarget(
        records, adapterId, context.networkRules.profileId,
      ) || await this.#target(adapterId, action, null);
      preview = adapterId === 'clash_verge_rev_managed'
        ? coordinator.prepareInstall({ context, targetFile })
        : coordinator.prepareInstall({ context, mainConfigFile: targetFile });
    } else {
      throw integrationError('INTEGRATION_ADAPTER_UNAVAILABLE');
    }
    this.pending = { kind: 'managed', adapterId };
    return preview;
  }

  async confirm({ confirmationHandle } = {}) {
    const pending = this.pending;
    this.pending = null;
    if (!pending) throw integrationError('INTEGRATION_TARGET_CHANGED');
    const context = this.getContext();
    try {
      if (pending.adapterId === 'openssh_proxy_command') this.ensureSidecar();
      if (pending.kind === 'generic') {
        return await this.genericCoordinator.confirm({ confirmationHandle, currentBinding: context.bindingFor(
          pending.adapterId, 1,
        ) });
      }
      const coordinator = pending.adapterId === 'clash_verge_rev_managed'
        ? this.clashVergeCoordinator : this.openSshCoordinator;
      return await coordinator.confirm({ confirmationHandle, context });
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  cancel() {
    const changed = [
      this.genericCoordinator.cancel(),
      this.clashVergeCoordinator.cancel(),
      this.openSshCoordinator.cancel(),
    ].some(Boolean);
    this.pending = null;
    return changed;
  }

  async #target(adapterId, action, existingTarget) {
    const selected = await this.selectTarget({ adapterId, action, existingTarget });
    if (selected == null) throw integrationError('INTEGRATION_EXPORT_CANCELLED');
    if (typeof selected !== 'string' || !path.isAbsolute(selected)) {
      throw integrationError('INTEGRATION_EXPORT_TARGET_INVALID');
    }
    return selected;
  }
}

function createIntegrationCenterRuntime({
  workspaceRoot,
  recordFile,
  getContext,
  selectTarget,
  ensureSidecar,
  writeClipboard,
  helperPath,
  credentialFile,
  fileSystem,
  platform = process.platform,
  windowsAcl,
} = {}) {
  const backupRoot = path.join(workspaceRoot, 'integration-backups');
  const fileTransaction = new ManagedFileTransaction({
    workspaceRoot, backupRoot, fileSystem, platform, windowsAcl,
  });
  const recordStore = new IntegrationRecordStore({
    workspaceRoot, filePath: recordFile, fileSystem, platform, windowsAcl,
  });
  const genericCoordinator = createGenericExportCoordinator({
    fileTransaction, writeClipboard,
  });
  const transactionOwner = new ManagedAdapterTransactionOwner({
    fileTransaction, recordStore,
  });
  const clashVergeCoordinator = new ClashVergeManagedCoordinator({
    fileTransaction, recordStore, transactionOwner, platform, fileSystem,
  });
  const openSshCoordinator = new OpenSshManagedCoordinator({
    fileTransaction, recordStore, transactionOwner, helperPath, credentialFile,
    platform, fileSystem,
  });
  return new IntegrationCenterRuntime({
    getContext, selectTarget, ensureSidecar, recordStore,
    genericCoordinator, clashVergeCoordinator, openSshCoordinator,
  });
}

function createDisabledIntegrationCenterRuntime() {
  return Object.freeze({
    list: () => Object.freeze(INTEGRATION_ADAPTER_IDS.map((adapterId) => (
      createIntegrationAdapterView({
        adapterId, compatibilityState: 'unavailable', bindingState: 'unavailable',
      })
    ))),
    prepare: async () => { throw integrationError('INTEGRATION_ADAPTER_UNAVAILABLE'); },
    confirm: () => { throw integrationError('INTEGRATION_ADAPTER_UNAVAILABLE'); },
    cancel: () => false,
  });
}

module.exports = {
  IntegrationCenterRuntime,
  createDisabledIntegrationCenterRuntime,
  createIntegrationCenterRuntime,
};
