'use strict';

function asOperation(value) {
  return typeof value === 'function' ? value : async () => undefined;
}

function transactionError(primary, recoveryFailures) {
  const error = primary instanceof Error ? primary : new Error(String(primary || '路由策略更新失败'));
  if (recoveryFailures.length) {
    error.rollbackIncomplete = true;
    error.recoveryFailures = recoveryFailures.map((failure) => String(failure?.message || failure));
  }
  return error;
}

function staleContextError() {
  const error = new Error('active context changed during mutation');
  error.code = 'stale_context';
  return error;
}

// JSON is the source of truth and both PAC representations are derived data.
// The browser is suspended before the source changes, then the source, external
// PAC and live Session are committed as one observable operation. A failure
// restores the old source/PAC/Session; if recovery itself fails the Session is
// deliberately left suspended and the caller must report a hard failure.
async function runRoutingPolicyTransaction({
  suspend,
  commit,
  applyExternal,
  applyBrowser,
  rollback,
  restoreExternal,
  restoreBrowser,
  contextCurrent = () => true,
} = {}) {
  if (typeof commit !== 'function' || typeof contextCurrent !== 'function') {
    throw new TypeError('路由策略事务缺少提交操作或上下文守卫');
  }
  const suspendOperation = asOperation(suspend);
  const applyExternalOperation = asOperation(applyExternal);
  const applyBrowserOperation = asOperation(applyBrowser);
  const rollbackOperation = asOperation(rollback);
  const restoreExternalOperation = asOperation(restoreExternal);
  const restoreBrowserOperation = asOperation(restoreBrowser);

  const requireCurrent = () => {
    if (contextCurrent() !== true) throw staleContextError();
  };
  requireCurrent();
  await suspendOperation();
  requireCurrent();
  let committed = false;
  try {
    let value;
    try {
      value = await commit();
      committed = true;
    } catch (error) {
      // Atomic stores can fail while confirming the directory fsync after the
      // rename commit point. They mark that state so rollback is mandatory.
      committed = error?.commitApplied === true;
      throw error;
    }
    requireCurrent();
    await applyExternalOperation();
    requireCurrent();
    await applyBrowserOperation();
    requireCurrent();
    return value;
  } catch (primary) {
    const recoveryFailures = [];
    if (committed) {
      for (const operation of [rollbackOperation, restoreExternalOperation]) {
        try { await operation(); } catch (error) { recoveryFailures.push(error); }
      }
    }
    // Resume only when the source and external PAC were both restored. If
    // either recovery step failed, keeping the Session suspended is safer than
    // guessing which policy is authoritative.
    if (!recoveryFailures.length && contextCurrent() === true) {
      try { await restoreBrowserOperation(); } catch (error) { recoveryFailures.push(error); }
    }
    if (contextCurrent() !== true) {
      try { await suspendOperation(); } catch (error) { recoveryFailures.push(error); }
    }
    throw transactionError(primary, recoveryFailures);
  }
}

class RoutingPolicyTransactionQueue {
  constructor({ isContextCurrent = () => true } = {}) {
    if (typeof isContextCurrent !== 'function') {
      throw new TypeError('mutation queue context guard is required');
    }
    this.isContextCurrent = isContextCurrent;
    this.chain = Promise.resolve();
    this.tail = this.chain;
    this.epoch = 1;
    this.unsafe = false;
  }

  run(contextToken, options) {
    if (!contextToken || typeof contextToken !== 'object') {
      return Promise.reject(new TypeError('mutation queue context token is required'));
    }
    const epoch = this.epoch;
    const current = () => epoch === this.epoch && this.isContextCurrent(contextToken) === true;
    const execute = () => {
      if (!current()) return Promise.reject(staleContextError());
      return runRoutingPolicyTransaction({
        ...(typeof options === 'function' ? options() : options),
        contextCurrent: current,
      });
    };
    const next = this.chain.then(
      execute,
      execute,
    );
    this.tail = next;
    this.chain = next.catch((error) => {
      if (error?.rollbackIncomplete === true) this.unsafe = true;
    });
    return next;
  }

  async cancelAndDrain() {
    this.epoch += 1;
    while (true) {
      const observed = this.tail;
      try { await observed; } catch {}
      if (this.tail === observed) break;
    }
    return !this.unsafe;
  }
}

module.exports = {
  RoutingPolicyTransactionQueue,
  runRoutingPolicyTransaction,
  transactionError,
};
