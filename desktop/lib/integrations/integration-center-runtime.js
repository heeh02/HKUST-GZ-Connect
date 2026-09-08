'use strict';

const path = require('node:path');
const {
  createGenericExportCoordinator,
} = require('./generic-export-coordinator');
const {
  ACTIVE_INTEGRATION_ADAPTER_IDS,
  createIntegrationAdapterView,
  validateIntegrationBinding,
} = require('./integration-schema');
const {
  AtomicExportFileTransaction,
} = require('./atomic-export-file-transaction');

const GENERIC = new Set(ACTIVE_INTEGRATION_ADAPTER_IDS);

function integrationError(code, cause = null) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

class IntegrationCenterRuntime {
  #intent = 0;
  constructor({
    getContext,
    selectTarget,
    genericCoordinator,
    helperPath,
    credentialFile,
  } = {}) {
    if (typeof getContext !== 'function' || typeof selectTarget !== 'function' ||
        !genericCoordinator ||
        typeof helperPath !== 'string' || !path.isAbsolute(helperPath) ||
        typeof credentialFile !== 'string' || !path.isAbsolute(credentialFile)) {
      throw new TypeError('Integration Center runtime dependencies are invalid');
    }
    Object.assign(this, {
      getContext, selectTarget, genericCoordinator,
      helperPath, credentialFile,
    });
    this.pending = null;
  }

  list() {
    return Object.freeze(ACTIVE_INTEGRATION_ADAPTER_IDS.map((adapterId) => {
      return createIntegrationAdapterView({
        adapterId,
        compatibilityState: GENERIC.has(adapterId) ? 'supported' : 'unavailable',
        bindingState: 'not-installed',
        updatedAt: null,
      });
    }));
  }

  async prepare({ adapterId, action } = {}) {
    if (!ACTIVE_INTEGRATION_ADAPTER_IDS.includes(adapterId)) {
      throw integrationError('INTEGRATION_ADAPTER_UNAVAILABLE');
    }
    if (!GENERIC.has(adapterId) || !['copy', 'save'].includes(action) ||
        (adapterId === 'vscode_remote_ssh' && action !== 'copy')) {
      throw integrationError('INTEGRATION_ADAPTER_UNAVAILABLE');
    }
    const intent = ++this.#intent;
    const initialBinding = validateIntegrationBinding(this.getContext(adapterId).bindingFor(adapterId, 1));
    let preview;
    if (GENERIC.has(adapterId)) {
      const targetFile = action === 'save'
        ? await this.#target(adapterId, action, null)
        : null;
      const { context, binding } = this.#current(intent, adapterId, initialBinding);
      preview = this.genericCoordinator.prepare({
        adapterId,
        action,
        binding,
        networkRules: context.networkRules,
        port: context.port,
        credential: context.credential,
        helperPath: this.helperPath,
        credentialFile: this.credentialFile,
        targetFile,
      });
      if (intent !== this.#intent) {
        this.genericCoordinator.cancel(preview.confirmationHandle);
        throw integrationError('INTEGRATION_TARGET_CHANGED');
      }
      this.pending = { kind: 'generic', adapterId, confirmationHandle: preview.confirmationHandle };
      return preview;
    }
    throw integrationError('INTEGRATION_ADAPTER_UNAVAILABLE');
  }

  async confirm({ confirmationHandle } = {}) {
    const pending = this.pending;
    if (!pending) throw integrationError('INTEGRATION_TARGET_CHANGED');
    this.pending = null;
    const intent = ++this.#intent;
    try {
      const context = this.getContext(pending.adapterId);
      const binding = validateIntegrationBinding(context.bindingFor(pending.adapterId, 1));
      if (intent !== this.#intent) throw integrationError('INTEGRATION_TARGET_CHANGED');
      return await this.genericCoordinator.confirm({ confirmationHandle, currentBinding: binding,
        assertCurrent: () => { this.#current(intent, pending.adapterId, binding); },
      });
    } catch (error) {
      // An older continuation has no authority over a replacement preview.
      this.genericCoordinator.cancel(pending.confirmationHandle);
      throw error;
    }
  }

  cancel() {
    this.#intent++;
    this.pending = null;
    return this.genericCoordinator.cancel();
  }

  #current(intent, adapterId, expected) {
    if (intent !== this.#intent) throw integrationError('INTEGRATION_TARGET_CHANGED');
    let context, binding;
    try {
      context = this.getContext(adapterId);
      binding = validateIntegrationBinding(context.bindingFor(adapterId, 1));
    } catch (error) { throw integrationError('INTEGRATION_PROFILE_STALE', error); }
    if (intent !== this.#intent) throw integrationError('INTEGRATION_TARGET_CHANGED');
    if (binding.bindingDigest !== expected.bindingDigest) throw integrationError('INTEGRATION_PROFILE_STALE');
    return { context, binding };
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
  const fileTransaction = new AtomicExportFileTransaction({ fileSystem, platform, windowsAcl });
  const genericCoordinator = createGenericExportCoordinator({
    fileTransaction, writeClipboard,
    beforePerform: ({ adapterId }) => {
      if (adapterId === 'vscode_remote_ssh') ensureSidecar();
    },
  });
  return new IntegrationCenterRuntime({
    getContext, selectTarget, genericCoordinator,
    helperPath, credentialFile,
  });
}

function createDisabledIntegrationCenterRuntime() {
  return Object.freeze({
    list: () => Object.freeze(ACTIVE_INTEGRATION_ADAPTER_IDS.map((adapterId) => (
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
