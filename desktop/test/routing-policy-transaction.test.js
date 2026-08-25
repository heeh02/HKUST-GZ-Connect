'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  RoutingPolicyTransactionQueue,
  runRoutingPolicyTransaction,
} = require('../lib/routing-policy-transaction');

test('routing policy commits source, external PAC, then browser under suspension', async () => {
  const calls = [];
  const result = await runRoutingPolicyTransaction({
    suspend: async () => calls.push('suspend'),
    commit: async () => { calls.push('commit'); return 'candidate'; },
    applyExternal: async () => calls.push('external'),
    applyBrowser: async () => calls.push('browser'),
    rollback: async () => calls.push('rollback'),
    restoreExternal: async () => calls.push('restore-external'),
    restoreBrowser: async () => calls.push('restore-browser'),
  });
  assert.equal(result, 'candidate');
  assert.deepEqual(calls, ['suspend', 'commit', 'external', 'browser']);
});

for (const failingStage of ['external', 'browser']) {
  test(`${failingStage} failure rolls the source, PAC, and live browser back in order`, async () => {
    const calls = [];
    const failure = new Error(`${failingStage} failed`);
    await assert.rejects(runRoutingPolicyTransaction({
      suspend: async () => calls.push('suspend'),
      commit: async () => calls.push('commit'),
      applyExternal: async () => {
        calls.push('external');
        if (failingStage === 'external') throw failure;
      },
      applyBrowser: async () => {
        calls.push('browser');
        if (failingStage === 'browser') throw failure;
      },
      rollback: async () => calls.push('rollback'),
      restoreExternal: async () => calls.push('restore-external'),
      restoreBrowser: async () => calls.push('restore-browser'),
    }), (error) => {
      assert.equal(error, failure);
      assert.equal(error.rollbackIncomplete, undefined);
      return true;
    });
    assert.deepEqual(calls, [
      'suspend',
      'commit',
      'external',
      ...(failingStage === 'browser' ? ['browser'] : []),
      'rollback',
      'restore-external',
      'restore-browser',
    ]);
  });
}

test('failed recovery leaves the browser suspended and marks rollback incomplete', async () => {
  const calls = [];
  await assert.rejects(runRoutingPolicyTransaction({
    suspend: async () => calls.push('suspend'),
    commit: async () => calls.push('commit'),
    applyExternal: async () => { calls.push('external'); throw new Error('disk full'); },
    rollback: async () => { calls.push('rollback'); throw new Error('JSON rollback failed'); },
    restoreExternal: async () => calls.push('restore-external'),
    restoreBrowser: async () => calls.push('restore-browser'),
  }), (error) => {
    assert.equal(error.message, 'disk full');
    assert.equal(error.rollbackIncomplete, true);
    assert.deepEqual(error.recoveryFailures, ['JSON rollback failed']);
    return true;
  });
  assert.deepEqual(calls, [
    'suspend', 'commit', 'external', 'rollback', 'restore-external',
  ], 'a partially restored source/PAC must not reactivate the Session');
});

test('a commit failure restores the old live browser without running source rollback', async () => {
  const calls = [];
  await assert.rejects(runRoutingPolicyTransaction({
    suspend: async () => calls.push('suspend'),
    commit: async () => { calls.push('commit'); throw new Error('JSON rename failed'); },
    rollback: async () => calls.push('rollback'),
    restoreExternal: async () => calls.push('restore-external'),
    restoreBrowser: async () => calls.push('restore-browser'),
  }), /JSON rename failed/);
  assert.deepEqual(calls, ['suspend', 'commit', 'restore-browser']);
});

test('a failure after an atomic rename is rolled back before browser restore', async () => {
  const calls = [];
  const failure = new Error('directory fsync failed');
  failure.commitApplied = true;
  await assert.rejects(runRoutingPolicyTransaction({
    suspend: async () => calls.push('suspend'),
    commit: async () => { calls.push('commit'); throw failure; },
    rollback: async () => calls.push('rollback'),
    restoreExternal: async () => calls.push('restore-external'),
    restoreBrowser: async () => calls.push('restore-browser'),
  }), (error) => error === failure);
  assert.deepEqual(calls, [
    'suspend', 'commit', 'rollback', 'restore-external', 'restore-browser',
  ]);
});

test('queued transaction factories run serially and observe the latest committed source', async () => {
  const token = Object.freeze({});
  const queue = new RoutingPolicyTransactionQueue({ isContextCurrent: (value) => value === token });
  const snapshots = [];
  let state = 0;
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  let firstCommitStarted;
  const firstStarted = new Promise((resolve) => { firstCommitStarted = resolve; });

  const makeTransaction = (next, blocked = null) => () => {
    const previous = state;
    snapshots.push(previous);
    return {
      commit: async () => {
        if (blocked) {
          firstCommitStarted();
          await blocked;
        }
        state = next;
        return next;
      },
      rollback: async () => { state = previous; },
    };
  };

  const first = queue.run(token, makeTransaction(1, firstBlocked));
  await firstStarted;
  const second = queue.run(token, makeTransaction(2));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(snapshots, [0], 'the second snapshot must not be captured before its turn');
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(snapshots, [0, 1]);
  assert.equal(state, 2);
});

test('cancelAndDrain rejects queued stale work before its factory observes state', async () => {
  const token = Object.freeze({});
  const queue = new RoutingPolicyTransactionQueue({ isContextCurrent: () => true });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let started;
  const firstStarted = new Promise((resolve) => { started = resolve; });
  let secondObserved = false;
  const first = queue.run(token, () => ({
    commit: async () => { started(); await blocked; },
  }));
  await firstStarted;
  const second = queue.run(token, () => {
    secondObserved = true;
    return { commit: async () => {} };
  });
  const draining = queue.cancelAndDrain();
  release();
  await assert.rejects(first, (error) => error.code === 'stale_context');
  await assert.rejects(second, (error) => error.code === 'stale_context');
  assert.equal(await draining, true);
  assert.equal(secondObserved, false);
});

test('stale in-flight commit rolls back old source and PAC then re-gates Browser', async () => {
  const token = Object.freeze({});
  let current = true;
  let releaseExternal;
  const externalBlocked = new Promise((resolve) => { releaseExternal = resolve; });
  let externalStarted;
  const externalStart = new Promise((resolve) => { externalStarted = resolve; });
  const calls = [];
  const queue = new RoutingPolicyTransactionQueue({ isContextCurrent: () => current });
  const mutation = queue.run(token, {
    suspend: async () => calls.push('suspend'),
    commit: async () => calls.push('commit'),
    applyExternal: async () => { calls.push('external'); externalStarted(); await externalBlocked; },
    applyBrowser: async () => calls.push('browser'),
    rollback: async () => calls.push('rollback'),
    restoreExternal: async () => calls.push('restore-external'),
    restoreBrowser: async () => calls.push('restore-browser'),
  });
  await externalStart;
  current = false;
  const draining = queue.cancelAndDrain();
  releaseExternal();
  await assert.rejects(mutation, (error) => error.code === 'stale_context');
  assert.equal(await draining, true);
  assert.deepEqual(calls, [
    'suspend', 'commit', 'external', 'rollback', 'restore-external', 'suspend',
  ]);
});

test('rollback uncertainty makes context drain fail closed permanently', async () => {
  const token = Object.freeze({});
  let current = true;
  const queue = new RoutingPolicyTransactionQueue({ isContextCurrent: () => current });
  const mutation = queue.run(token, {
    commit: async () => { current = false; },
    rollback: async () => { throw new Error('rollback failed'); },
    restoreExternal: async () => {},
  });
  await assert.rejects(mutation, (error) => error.rollbackIncomplete === true);
  assert.equal(await queue.cancelAndDrain(), false);
});
