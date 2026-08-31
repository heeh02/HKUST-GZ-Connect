(function initializeCardBoardAdapter(root, factory) {
  const api = factory(
    typeof module !== 'undefined' && module.exports ? require('./card-board-model') : root.cardBoardModel,
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.cardBoardAdapter = api;
})(typeof self !== 'undefined' ? self : globalThis, function cardBoardAdapterFactory(model) {
  'use strict';

  if (!model) throw new TypeError('card board adapter model is required');

  function localeStrings(document) {
    const english = String(document?.documentElement?.lang || '').toLowerCase().startsWith('en');
    return english ? Object.freeze({
      edit: 'Organize', done: 'Done', cancel: 'Cancel', undo: 'Undo', redo: 'Redo', reset: 'Restore Layout',
      saveFailed: 'The layout was not saved. Try again.', stale: 'The layout changed. Review the latest layout and retry.',
      emptyCategory: 'No sites in this category', expandAll: 'Show all ({count})', emptyBoard: 'No cards here yet',
      emptyBoardHint: 'Restore or pin cards while organizing.', noResults: 'No matching sites', dragCard: 'Move card',
      resizeCard: 'Change card size', pinToConnect: 'Pin to Connection', removeFromConnect: 'Remove from Connection',
      hideCard: 'Hide from this board', draftChanged: 'Layout draft changed', saved: 'Layout saved',
    }) : Object.freeze({
      edit: '整理', done: '完成', cancel: '取消', undo: '撤销', redo: '重做', reset: '恢复布局',
      saveFailed: '布局未保存，请重试。', stale: '布局已变化，请基于最新布局重试。',
      emptyCategory: '此分类暂无网站', expandAll: '展开全部（{count}）', emptyBoard: '这里还没有卡片',
      emptyBoardHint: '可在整理模式中恢复或固定卡片。', noResults: '没有符合条件的网站', dragCard: '拖动卡片',
      resizeCard: '调整卡片尺寸', pinToConnect: '固定到连接页', removeFromConnect: '从连接页移除',
      hideCard: '从当前页面隐藏', draftChanged: '布局草稿已更改', saved: '布局已保存',
    });
  }

  function createMemoryAdapter(initialDocument = null) {
    let document = model.cloneDocument(initialDocument);
    return Object.freeze({
      async get() { return { document: model.cloneDocument(document) }; },
      async commit({ baseRevision, operations }) {
        if (baseRevision !== document.revision) {
          const error = new Error('card board revision conflict');
          error.code = 'CARD_BOARD_REVISION_CONFLICT';
          throw error;
        }
        document = model.applyDraftOperations(document, operations);
        document.revision += 1;
        return { document: model.cloneDocument(document), changed: operations.length > 0 };
      },
      async reset({ baseRevision }) {
        if (baseRevision !== document.revision) {
          const error = new Error('card board revision conflict');
          error.code = 'CARD_BOARD_REVISION_CONFLICT';
          throw error;
        }
        document = { schemaVersion: 1, revision: document.revision + 1, placements: [], decks: [] };
        return { document: model.cloneDocument(document), changed: true };
      },
    });
  }

  function normalizeAdapter(adapter, fallbackDocument) {
    const memory = createMemoryAdapter(fallbackDocument);
    return Object.freeze({
      get: typeof adapter?.get === 'function' ? adapter.get.bind(adapter) : memory.get,
      commit: typeof adapter?.commit === 'function' ? adapter.commit.bind(adapter) : memory.commit,
      reset: typeof adapter?.reset === 'function' ? adapter.reset.bind(adapter) : memory.reset,
    });
  }

  function resultDocument(result) {
    return result?.document || result?.layout || (result?.schemaVersion === 1 ? result : null);
  }

  return Object.freeze({ createMemoryAdapter, localeStrings, normalizeAdapter, resultDocument });
});
