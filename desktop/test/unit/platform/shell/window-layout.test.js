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
    width: 620,
    height: 720,
    minWidth: 420,
    minHeight: 560,
    maxWidth: 960,
    maxHeight: 960,
  });
  assert.deepEqual(clampWindowSize(300, 1000), { width: 420, height: 960 });
  assert.deepEqual(clampWindowSize(620, 640), { width: 620, height: 640 });
});

test('layout mode switches to the compact workspace below the wide breakpoint', () => {
  assert.equal(layoutMode(620), 'wide');
  assert.equal(layoutMode(619), 'compact');
});
