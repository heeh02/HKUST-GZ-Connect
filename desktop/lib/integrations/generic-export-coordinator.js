'use strict';

const {
  GenericExportTransactionOwner,
} = require('./generic-export-transaction');
const {
  validateGenericExportPayload,
} = require('./generic-export-adapters');

class GenericExportCoordinator {
  constructor({ transactionOwner, fileTransaction, writeClipboard, beforePerform = () => {} } = {}) {
    if (!transactionOwner || typeof transactionOwner.prepare !== 'function' ||
        typeof transactionOwner.execute !== 'function' ||
        typeof transactionOwner.cancel !== 'function' ||
        !fileTransaction || typeof fileTransaction.apply !== 'function' ||
        typeof writeClipboard !== 'function' || typeof beforePerform !== 'function') {
      throw new TypeError('generic export coordinator dependencies are invalid');
    }
    this.transactionOwner = transactionOwner;
    this.fileTransaction = fileTransaction;
    this.writeClipboard = writeClipboard;
    this.beforePerform = beforePerform;
  }

  prepare(value) {
    return this.transactionOwner.prepare(value);
  }

  confirm({ confirmationHandle, currentBinding } = {}) {
    return this.transactionOwner.execute({
      confirmationHandle,
      currentBinding,
      perform: async ({ adapterId, action, targetPlan, payload }) => {
        if (!validateGenericExportPayload(adapterId, payload)) {
          throw new Error('generated integration payload failed validation');
        }
        await this.beforePerform({ adapterId, action });
        if (action === 'copy') {
          let text = payload.toString('utf8');
          try {
            if (this.writeClipboard(text) !== true) throw new Error('clipboard write failed');
          } finally { text = ''; }
          return;
        }
        if (action !== 'save' || !targetPlan) throw new Error('save plan is unavailable');
        this.fileTransaction.apply(
          targetPlan,
          payload,
          (candidate) => validateGenericExportPayload(adapterId, candidate),
        );
      },
    });
  }

  cancel() {
    return this.transactionOwner.cancel();
  }
}

function createGenericExportCoordinator({
  fileTransaction,
  writeClipboard,
  randomBytes,
  now,
  ttlMs,
  beforePerform,
} = {}) {
  const transactionOwner = new GenericExportTransactionOwner({
    fileTransaction, randomBytes, now, ttlMs,
  });
  return new GenericExportCoordinator({
    transactionOwner, fileTransaction, writeClipboard, beforePerform,
  });
}

module.exports = {
  GenericExportCoordinator,
  createGenericExportCoordinator,
};
