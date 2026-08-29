'use strict';

const CONTROL_WINDOW = Object.freeze({
  width: 840,
  height: 900,
  minWidth: 760,
  minHeight: 680,
  maxWidth: 1480,
  maxHeight: 1180,
});

function clampWindowSize(width, height) {
  return {
    width: Math.max(CONTROL_WINDOW.minWidth, Math.min(CONTROL_WINDOW.maxWidth, Math.ceil(Number(width) || CONTROL_WINDOW.width))),
    height: Math.max(CONTROL_WINDOW.minHeight, Math.min(CONTROL_WINDOW.maxHeight, Math.ceil(Number(height) || CONTROL_WINDOW.height))),
  };
}

function layoutMode(width) {
  return Number(width) >= 1080 ? 'wide' : 'compact';
}

module.exports = { CONTROL_WINDOW, clampWindowSize, layoutMode };
