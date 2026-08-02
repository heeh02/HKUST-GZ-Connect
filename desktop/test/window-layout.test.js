'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CONTROL_WINDOW,
  clampWindowSize,
  layoutMode,
} = require('../lib/window-layout');

test('control window uses a resizable bounded compact default', () => {
  assert.deepEqual(CONTROL_WINDOW, {
    width: 500,
    height: 640,
    minWidth: 420,
    minHeight: 560,
    maxWidth: 760,
    maxHeight: 900,
  });
  assert.deepEqual(clampWindowSize(300, 1000), { width: 420, height: 900 });
  assert.deepEqual(clampWindowSize(620, 640), { width: 620, height: 640 });
});

test('layout mode switches to a compact one-column view below the wide breakpoint', () => {
  assert.equal(layoutMode(620), 'wide');
  assert.equal(layoutMode(619), 'compact');
});
