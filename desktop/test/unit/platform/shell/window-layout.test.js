'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CONTROL_WINDOW,
  clampWindowSize,
  layoutMode,
} = require('../../../../lib/platform/shell/window-layout');

test('control window uses a resizable Workspace default with a compact minimum', () => {
  assert.deepEqual(CONTROL_WINDOW, {
    width: 840,
    height: 900,
    minWidth: 760,
    minHeight: 680,
    maxWidth: 1480,
    maxHeight: 1180,
  });
  assert.deepEqual(clampWindowSize(300, 1400), { width: 760, height: 1180 });
  assert.deepEqual(clampWindowSize(840, 900), { width: 840, height: 900 });
});

test('layout mode switches to the compact workspace below the wide breakpoint', () => {
  assert.equal(layoutMode(1080), 'wide');
  assert.equal(layoutMode(1079), 'compact');
});
