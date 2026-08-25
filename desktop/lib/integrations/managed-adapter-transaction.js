'use strict';

const crypto = require('node:crypto');
const {
  validateIntegrationBinding,
} = require('./integration-schema');

const MANAGED_ADAPTER_TTL_MS = 120_000;
const MANAGED_ACTIONS = Object.freeze(['install', 'update', 'remove']);
const MANAGED_ADAPTERS = Object.freeze([
  'clash_verge_rev_managed', 'openssh_proxy_command', 'user_selected_managed_block',
]);

class ManagedAdapterError extends Error {
  constructor(code, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = 'ManagedAdapterError';
    this.code = code;
  }
}

function handle(randomBytes) {
  let bytes = randomBytes(16);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 16) {
    bytes?.fill?.(0);
    throw new ManagedAdapterError('INTEGRATION_INSTALL_FAILED');
  }
  try { return `managed-${bytes.toString('hex')}`; }
  finally { bytes.fill(0); bytes = null; }
}

class ManagedAdapterTransactionOwner {
  #record = null;
  #cleanup = [];

  constructor({
    fileTransaction,
    recordStore,
    randomBytes = crypto.randomBytes,
    now = Date.now,
    ttlMs = MANAGED_ADAPTER_TTL_MS,
  } = {}) {
    if (!fileTransaction || typeof fileTransaction.stage !== 'function' ||
        typeof fileTransaction.rollback !== 'function' ||
        typeof fileTransaction.finalize !== 'function' ||
        !recordStore || typeof recordStore.apply !== 'function' ||
        typeof randomBytes !== 'function' || typeof now !== 'function' ||
        !Number.isSafeInteger(ttlMs) || ttlMs < 10_000 || ttlMs > 300_000) {
      throw new TypeError('managed adapter transaction dependencies are invalid');
    }
    Object.assign(this, { fileTransaction, recordStore, randomBytes, now, ttlMs });
  }

  prepare({
    adapterId,
    action,
    binding: bindingValue,
    fileMutations,
    recordPlan,
    containsLocalProxyCredential = false,
    warningCodes = [],
  } = {}) {
    if (!this.retryCleanup()) {
      throw new ManagedAdapterError('INTEGRATION_ROLLBACK_INCOMPLETE');
    }
    this.cancel();
    if (!MANAGED_ADAPTERS.includes(adapterId) || !MANAGED_ACTIONS.includes(action) ||
        bindingValue?.adapterId !== adapterId || !Array.isArray(fileMutations) ||
        !fileMutations.length || fileMutations.length > 4 ||
        !recordPlan || typeof recordPlan !== 'object' ||
        typeof containsLocalProxyCredential !== 'boolean' || !Array.isArray(warningCodes) ||
        warningCodes.some((code) => typeof code !== 'string' || !/^INTEGRATION_[A-Z_]+$/u.test(code))) {
      throw new ManagedAdapterError('INTEGRATION_ADAPTER_UNAVAILABLE');
    }
    const binding = validateIntegrationBinding(bindingValue);
    let mutations;
    try {
      mutations = fileMutations.map((mutation) => {
        if (!mutation || typeof mutation !== 'object' || !mutation.plan ||
            !['create', 'replace', 'remove', 'unchanged'].includes(mutation.plan.change) ||
            (mutation.payload !== null && !Buffer.isBuffer(mutation.payload)) ||
            typeof mutation.validate !== 'function') {
          throw new ManagedAdapterError('INTEGRATION_ADAPTER_UNAVAILABLE');
        }
        return {
          plan: mutation.plan,
          payload: mutation.payload,
          validate: mutation.validate,
        };
      });
    } catch (error) {
      for (const mutation of fileMutations) mutation?.payload?.fill?.(0);
      throw error;
    }
    let confirmationHandle;
    try { confirmationHandle = handle(this.randomBytes); }
    catch (error) {
      for (const mutation of mutations) mutation.payload?.fill(0);
      throw error;
    }
    const expiresAt = this.now() + this.ttlMs;
    this.#record = {
      confirmationHandle, adapterId, action, binding, mutations, recordPlan, expiresAt,
    };
    const changes = { create: 0, replace: 0, remove: 0, unchanged: 0 };
    for (const mutation of mutations) changes[mutation.plan.change] += 1;
    return Object.freeze({
      schemaVersion: 1,
      confirmationHandle,
      adapterId,
      action,
      expiresAt,
      fileCount: mutations.length,
      changes: Object.freeze(changes),
      containsLocalProxyCredential,
      warningCodes: Object.freeze([...warningCodes]),
    });
  }

  confirm({ confirmationHandle, currentBinding } = {}) {
    const record = this.#take(confirmationHandle);
    const staged = [];
    try {
      const current = validateIntegrationBinding(currentBinding);
      if (current.bindingDigest !== record.binding.bindingDigest) {
        throw new ManagedAdapterError('INTEGRATION_PROFILE_STALE');
      }
      for (const mutation of record.mutations) {
        staged.push(this.fileTransaction.stage(
          mutation.plan, mutation.payload, mutation.validate,
        ));
      }
      try { this.recordStore.apply(record.recordPlan); }
      catch (cause) {
        throw new ManagedAdapterError(this.#actionFailure(record.action), cause);
      }
      let cleanupPending = false;
      for (const token of staged) {
        try { this.fileTransaction.finalize(token); }
        catch { this.#cleanup.push(token); cleanupPending = true; }
      }
      return Object.freeze({
        ok: true, adapterId: record.adapterId, action: record.action, cleanupPending,
      });
    } catch (error) {
      if (staged.length && !this.#rollback(staged)) {
        throw new ManagedAdapterError('INTEGRATION_ROLLBACK_INCOMPLETE', error);
      }
      if (error instanceof ManagedAdapterError) throw error;
      throw new ManagedAdapterError(this.#actionFailure(record.action), error);
    } finally {
      for (const mutation of record.mutations) mutation.payload?.fill(0);
    }
  }

  cancel() {
    if (!this.#record) return false;
    for (const mutation of this.#record.mutations) mutation.payload?.fill(0);
    this.#record = null;
    return true;
  }

  retryCleanup() {
    if (!this.#cleanup.length) return true;
    const remaining = [];
    for (const token of this.#cleanup) {
      try { this.fileTransaction.finalize(token); }
      catch { remaining.push(token); }
    }
    this.#cleanup = remaining;
    return !remaining.length;
  }

  #rollback(tokens) {
    let complete = true;
    for (const token of [...tokens].reverse()) {
      try { if (!this.fileTransaction.rollback(token)) complete = false; }
      catch { complete = false; }
    }
    return complete;
  }

  #take(value) {
    const record = this.#record;
    this.#record = null;
    if (!record || typeof value !== 'string' || value !== record.confirmationHandle ||
        this.now() >= record.expiresAt) {
      for (const mutation of record?.mutations || []) mutation.payload?.fill(0);
      throw new ManagedAdapterError('INTEGRATION_TARGET_CHANGED');
    }
    return record;
  }

  #actionFailure(action) {
    return {
      install: 'INTEGRATION_INSTALL_FAILED',
      update: 'INTEGRATION_UPDATE_FAILED',
      remove: 'INTEGRATION_REMOVE_FAILED',
    }[action];
  }
}

module.exports = {
  MANAGED_ADAPTER_TTL_MS,
  ManagedAdapterError,
  ManagedAdapterTransactionOwner,
};
