'use strict';

const path = require('node:path');
const { CardBoardRuntime } = require('../card-board/runtime/card-board-runtime');
const { CardBoardStore } = require('../card-board/runtime/card-board-store');
const { assertTrustedIpcSender } = require('../ipc/ipc-guard');

const OFFICIAL_CATEGORY_ORDER = Object.freeze([
  'gateway', 'courses', 'research', 'labs', 'student-finance', 'expenses',
  'documents', 'campus-life', 'career', 'tools', 'newcomer', 'staff',
]);
const CONNECT_WIDGET_IDS = Object.freeze([
  'connection-metrics', 'network-adapter', 'connection-details',
]);

function createCardBoardMainRuntime({
  favoritesFile,
  platform,
  ipcMain,
  allowedFiles,
  getResources,
  getGroups,
  runTransaction,
  onChanged,
} = {}) {
  if (typeof favoritesFile !== 'string' || !path.isAbsolute(favoritesFile) ||
      !['darwin', 'linux', 'win32'].includes(platform) ||
      !ipcMain || typeof ipcMain.handle !== 'function' ||
      !Array.isArray(allowedFiles) || !allowedFiles.length ||
      [getResources, getGroups, runTransaction, onChanged].some((value) => typeof value !== 'function')) {
    throw new TypeError('card board Main runtime dependencies are incomplete');
  }
  const store = new CardBoardStore({
    filePath: path.join(path.dirname(favoritesFile), 'card-board-layout.json'),
    platform,
  });
  const runtime = new CardBoardRuntime({ store });

  const authority = () => {
    const resources = getResources();
    const categories = new Set(resources
      .filter(({ reviewed }) => reviewed === true)
      .map(({ category }) => category));
    const groups = getGroups();
    const assigned = new Set(groups.flatMap(({ resourceIds }) => resourceIds));
    return Object.freeze({
      officialCategoryIds: Object.freeze([
        ...OFFICIAL_CATEGORY_ORDER.filter((category) => categories.delete(category)),
        ...[...categories].sort(),
      ]),
      userCollectionIds: Object.freeze(groups.map(({ id }) => id)),
      includeUngroupedFavorites: resources.some(({ id, favorite }) => favorite && !assigned.has(id)),
      connectWidgetIds: CONNECT_WIDGET_IDS,
    });
  };

  const mutate = (request, reset) => runTransaction(() => {
    const currentAuthority = authority();
    const previous = runtime.snapshot(currentAuthority).document;
    let result = null;
    return {
      commit: () => {
        result = reset
          ? runtime.reset(request, currentAuthority)
          : runtime.commit(request, currentAuthority);
        return result;
      },
      applyExternal: () => onChanged(result.document),
      rollback: () => store.replace(previous),
    };
  });

  return Object.freeze({
    register(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => {
        assertTrustedIpcSender(event, { allowedFiles });
        return handler(event, ...args);
      });
    },
    getLayout: () => runtime.snapshot(authority()),
    commitLayout: (request) => mutate(request, false),
    resetLayout: (request) => mutate(request, true),
  });
}

module.exports = { createCardBoardMainRuntime };
