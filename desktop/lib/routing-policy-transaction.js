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
} = {}) {
  if (typeof commit !== 'function') throw new TypeError('路由策略事务缺少提交操作');
  const suspendOperation = asOperation(suspend);
  const applyExternalOperation = asOperation(applyExternal);
  const applyBrowserOperation = asOperation(applyBrowser);
  const rollbackOperation = asOperation(rollback);
  const restoreExternalOperation = asOperation(restoreExternal);
  const restoreBrowserOperation = asOperation(restoreBrowser);

  await suspendOperation();
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
    await applyExternalOperation();
    await applyBrowserOperation();
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
    if (!recoveryFailures.length) {
      try { await restoreBrowserOperation(); } catch (error) { recoveryFailures.push(error); }
    }
    throw transactionError(primary, recoveryFailures);
  }
}

class RoutingPolicyTransactionQueue {
  constructor() {
    this.chain = Promise.resolve();
  }

  run(options) {
    const execute = () => runRoutingPolicyTransaction(
      typeof options === 'function' ? options() : options,
    );
    const next = this.chain.then(
      execute,
      execute,
    );
    this.chain = next.catch(() => {});
    return next;
  }
}

module.exports = {
  RoutingPolicyTransactionQueue,
  runRoutingPolicyTransaction,
  transactionError,
};
