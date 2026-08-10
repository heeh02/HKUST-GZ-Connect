'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  STOP_CONTROL_GRACE_MS,
  STOP_GRACE_MS,
  STOP_FORCE_WAIT_MS,
  stopPhase,
} = require('../lib/stop-policy');

test('stop policy allows the engine logout grace window before forcing it', () => {
  assert.equal(stopPhase(STOP_GRACE_MS - 1), 'grace');
  assert.equal(stopPhase(STOP_GRACE_MS), 'force');
  assert.equal(stopPhase(STOP_GRACE_MS + STOP_FORCE_WAIT_MS - 1), 'force');
  assert.equal(stopPhase(STOP_GRACE_MS + STOP_FORCE_WAIT_MS), 'failed');
});

test('stop policy accounts for the optional Control v2 grace window', () => {
  assert.equal(stopPhase(STOP_CONTROL_GRACE_MS - 1, { withControl: true }), 'control');
  assert.equal(stopPhase(STOP_CONTROL_GRACE_MS, { withControl: true }), 'grace');
  assert.equal(
    stopPhase(STOP_CONTROL_GRACE_MS + STOP_GRACE_MS, { withControl: true }),
    'force',
  );
  assert.equal(
    stopPhase(
      STOP_CONTROL_GRACE_MS + STOP_GRACE_MS + STOP_FORCE_WAIT_MS,
      { withControl: true },
    ),
    'failed',
  );
});
