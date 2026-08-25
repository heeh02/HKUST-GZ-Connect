'use strict';

const CONTROL_WINDOW = Object.freeze({
  width: 620,
  height: 720,
  minWidth: 420,
  minHeight: 560,
  maxWidth: 960,
  maxHeight: 960,
});

function clampWindowSize(width, height) {
  return {
    width: Math.max(CONTROL_WINDOW.minWidth, Math.min(CONTROL_WINDOW.maxWidth, Math.ceil(Number(width) || CONTROL_WINDOW.width))),
    height: Math.max(CONTROL_WINDOW.minHeight, Math.min(CONTROL_WINDOW.maxHeight, Math.ceil(Number(height) || CONTROL_WINDOW.height))),
  };
}

function layoutMode(width) {
  return Number(width) >= 620 ? 'wide' : 'compact';
}

module.exports = { CONTROL_WINDOW, clampWindowSize, layoutMode };
