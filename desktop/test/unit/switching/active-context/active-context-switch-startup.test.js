'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  assertActiveContextSwitchStartupClear,
} = require('../../../../lib/switching/active-context/active-context-switch-startup');

const FILE = path.resolve('/tmp/campus-active-context-switch.json');

test('legacy mode defers to migration preconditions without opening a switch journal', () => {
  let stores = 0;
  assert.deepEqual(assertActiveContextSwitchStartupClear({
    mode: 'legacy-flat',
    filePath: FILE,
    createStore: () => { stores += 1; throw new Error('must not open'); },
  }), { clear: true, mode: 'legacy-flat' });
  assert.equal(stores, 0);
});

test('Profile Workspace starts only when the exact switch path is absent', () => {
  let observedPath = null;
  assert.deepEqual(assertActiveContextSwitchStartupClear({
    mode: 'profile-workspace',
    filePath: FILE,
    createStore: ({ filePath }) => ({
      read() { observedPath = filePath; return null; },
    }),
  }), { clear: true, mode: 'profile-workspace' });
  assert.equal(observedPath, FILE);
});

for (const state of ['prepared', 'ready', 'committed']) {
  test(`${state} switch authority blocks startup before credentials or Browser`, () => {
    assert.throws(() => assertActiveContextSwitchStartupClear({
      mode: 'profile-workspace',
      filePath: FILE,
      createStore: () => ({ read: () => ({ state }) }),
    }), (error) => error.code === 'ACTIVE_CONTEXT_SWITCH_RECOVERY_REQUIRED' &&
      error.switchState === state);
  });
}

test('unreadable or corrupt switch authority is distinct and fail closed', () => {
  assert.throws(() => assertActiveContextSwitchStartupClear({
    mode: 'profile-workspace',
    filePath: FILE,
    createStore: () => ({ read() { throw new Error('synthetic corruption'); } }),
  }), (error) => error.code === 'ACTIVE_CONTEXT_SWITCH_UNREADABLE' &&
    error.cause?.message === 'synthetic corruption');
});
