'use strict';

const {
  MAX_CARD_BOARD_OPERATIONS,
  validateCardBoardOperation,
} = require('../card-board/runtime/card-board-runtime');
const { allowedKeys } = require('./ipc-guard');

function baseRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('卡片布局版本无效');
  }
  return value;
}

function cardBoardCommitRequestFromIpc(value) {
  const source = allowedKeys(value, ['baseRevision', 'operations']);
  if (!Array.isArray(source.operations) || !source.operations.length ||
      source.operations.length > MAX_CARD_BOARD_OPERATIONS) {
    throw new TypeError('卡片布局操作无效');
  }
  return Object.freeze({
    baseRevision: baseRevision(source.baseRevision),
    operations: Object.freeze(source.operations.map(validateCardBoardOperation)),
  });
}

function cardBoardResetRequestFromIpc(value) {
  const source = allowedKeys(value, ['baseRevision']);
  return Object.freeze({ baseRevision: baseRevision(source.baseRevision) });
}

function registerCardBoardIpc({
  register,
  getLayout,
  commitLayout,
  resetLayout,
} = {}) {
  for (const dependency of [register, getLayout, commitLayout, resetLayout]) {
    if (typeof dependency !== 'function') {
      throw new TypeError('card board IPC dependencies are incomplete');
    }
  }
  register('get-card-board-layout', (_event, ...args) => {
    if (args.length) throw new TypeError('卡片布局读取不接受参数');
    return getLayout();
  });
  register('commit-card-board-layout', (_event, value) => (
    commitLayout(cardBoardCommitRequestFromIpc(value))
  ));
  register('reset-card-board-layout', (_event, value) => (
    resetLayout(cardBoardResetRequestFromIpc(value))
  ));
}

module.exports = {
  cardBoardCommitRequestFromIpc,
  cardBoardResetRequestFromIpc,
  registerCardBoardIpc,
};
