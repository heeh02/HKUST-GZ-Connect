'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  cardBoardCommitRequestFromIpc,
  cardBoardResetRequestFromIpc,
  registerCardBoardIpc,
} = require('../../../lib/ipc/card-board-ipc');

test('card board IPC retains only revision-bound ID operations', () => {
  assert.deepEqual(cardBoardCommitRequestFromIpc({
    baseRevision: 4,
    operations: [{
      type: 'resize-placement',
      placementId: 'placement_abcdefghijkl',
      size: 'medium',
    }],
  }), {
    baseRevision: 4,
    operations: [{
      type: 'resize-placement',
      placementId: 'placement_abcdefghijkl',
      size: 'medium',
    }],
  });
  assert.deepEqual(cardBoardResetRequestFromIpc({ baseRevision: 7 }), { baseRevision: 7 });
  assert.throws(() => cardBoardCommitRequestFromIpc({
    baseRevision: 1,
    operations: [{ type: 'resize-placement', placementId: 'x', size: 'large', url: 'https://example.edu' }],
  }));
  assert.throws(() => cardBoardResetRequestFromIpc({ baseRevision: 1, path: '/tmp/layout' }));
});

test('card board IPC registers one read and two bounded mutations', async () => {
  const handlers = new Map();
  const calls = [];
  registerCardBoardIpc({
    register: (name, handler) => handlers.set(name, handler),
    getLayout: () => ({ document: { revision: 2 }, changed: false }),
    commitLayout: (request) => { calls.push(['commit', request]); return { ok: true }; },
    resetLayout: (request) => { calls.push(['reset', request]); return { ok: true }; },
  });
  assert.deepEqual([...handlers.keys()], [
    'get-card-board-layout', 'commit-card-board-layout', 'reset-card-board-layout',
  ]);
  assert.deepEqual(await handlers.get('get-card-board-layout')({}), {
    document: { revision: 2 }, changed: false,
  });
  await handlers.get('commit-card-board-layout')({}, {
    baseRevision: 2,
    operations: [{
      type: 'hide-placement', placementId: 'placement_abcdefghijkl',
    }],
  });
  await handlers.get('reset-card-board-layout')({}, { baseRevision: 3 });
  assert.equal(calls.length, 2);
  assert.throws(() => handlers.get('get-card-board-layout')({}, 'unexpected'));
});
