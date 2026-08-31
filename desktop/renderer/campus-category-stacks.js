'use strict';

(function initializeCampusCategoryBoard(globalScope, stackLayout, workspaceModel, cardBoardController, cardBoardModel) {
  if (!stackLayout?.balancedPartitions || !workspaceModel?.catalogProjection ||
      !workspaceModel?.categoryOf || !cardBoardController?.create || !cardBoardModel) {
    throw new TypeError('campus category board dependencies are required');
  }

  const { balancedPartitions } = stackLayout;
  let current = null;
  let currentView = 'catalog';
  let documentRef = null;
  let documentNode = null;
  let catalogController = null;
  let personalController = null;
  let connectController = null;
  let catalogWrap = null;
  let personalWrap = null;
  let started = false;

  function getLayoutCapacity(width, height) {
    const columns = cardBoardModel.columnsForWidth(width);
    return cardBoardModel.layoutCapacity(columns, height);
  }

  function personalCategoryProjection(resources, groups, translate) {
    const favorites = (Array.isArray(resources) ? resources : []).filter(({ favorite }) => favorite === true);
    const byId = new Map(favorites.map((resource) => [resource.id, resource]));
    const assigned = new Set();
    const projected = (Array.isArray(groups) ? groups : []).map((group) => {
      const items = (Array.isArray(group.resourceIds) ? group.resourceIds : [])
        .map((id) => byId.get(id)).filter(Boolean);
      items.forEach(({ id }) => assigned.add(id));
      return { id: group.id, name: group.name, kind: 'user-collection', items };
    }).filter(({ id, name }) => typeof id === 'string' && typeof name === 'string' && name.trim());
    const ungrouped = favorites.filter(({ id }) => !assigned.has(id));
    if (ungrouped.length) {
      projected.unshift({ id: 'ungrouped-favorites', name: translate('browser.ungrouped'), kind: 'system-widget', items: ungrouped });
    }
    return projected;
  }

  function categoryTranslationKey(labelKey) {
    const value = String(labelKey || 'custom');
    return `resources.category${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  }

  function officialCategoryProjection(resources, translate) {
    const reviewed = (Array.isArray(resources) ? resources : []).filter(({ reviewed }) => reviewed === true);
    const gateways = reviewed.filter(({ category }) => category === 'gateway');
    const projection = workspaceModel.catalogProjection(reviewed);
    const categories = projection.categories.map((category) => ({
      id: category.id,
      name: translate(categoryTranslationKey(category.labelKey)),
      kind: 'official-category',
      items: workspaceModel.catalogProjection(reviewed, category.id).items,
    }));
    if (gateways.length) {
      categories.unshift({
        id: 'gateway',
        name: translate('browser.gatewayCategory'),
        kind: 'official-category',
        items: gateways,
      });
    }
    return categories;
  }

  function hasOfficialCatalog(resources = current?.resources) {
    return (Array.isArray(resources) ? resources : []).some(({ reviewed }) => reviewed === true);
  }

  function syncSourceTabs({ focus = false } = {}) {
    const catalogAvailable = hasOfficialCatalog();
    if (!catalogAvailable && currentView === 'catalog') currentView = 'personal';
    const catalog = documentNode?.getElementById('categoryModeCatalog');
    const personal = documentNode?.getElementById('categoryModePersonal');
    if (!catalog || !personal) return currentView;
    catalog.hidden = !catalogAvailable;
    const editing = catalogController?.isEditing() || personalController?.isEditing();
    for (const [button, view] of [[catalog, 'catalog'], [personal, 'personal']]) {
      const active = currentView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      button.disabled = editing;
    }
    if (focus) (currentView === 'catalog' ? catalog : personal).focus();
    if (catalogWrap && personalWrap) {
      catalogWrap.hidden = currentView !== 'catalog';
      personalWrap.hidden = currentView !== 'personal';
    }
    return currentView;
  }

  function activeController() {
    return currentView === 'personal' ? personalController : catalogController;
  }

  function syncManageButton(editing) {
    const button = documentNode?.getElementById('manageResources');
    if (!button) return;
    const english = String(documentNode.documentElement.lang || '').toLowerCase().startsWith('en');
    button.textContent = editing ? (english ? 'Done' : '完成') : (english ? 'Organize' : '整理');
    button.setAttribute('aria-pressed', String(editing));
    syncSourceTabs();
  }

  function adapterForMainWindow() {
    const api = globalScope?.api;
    if (![api?.getCardBoardLayout, api?.commitCardBoardLayout, api?.resetCardBoardLayout]
      .every((method) => typeof method === 'function')) return null;
    return Object.freeze({
      get: () => api.getCardBoardLayout(),
      commit: (payload) => api.commitCardBoardLayout(payload),
      reset: (payload) => api.resetCardBoardLayout(payload),
    });
  }

  function syncDocument(nextDocument) {
    if (!nextDocument) return;
    documentRef = cardBoardModel.cloneDocument(nextDocument);
    catalogController?.setDocument(documentRef);
    personalController?.setDocument(documentRef);
    connectController?.setDocument(documentRef);
    const connectBoard = documentNode?.getElementById('connectCardBoard');
    if (connectBoard) {
      connectBoard.hidden = !documentRef.placements.some((placement) =>
        placement.boardId === 'connect' && placement.hidden !== true && placement.card.kind !== 'system-widget');
    }
  }

  function createBoardHost(className) {
    const wrap = documentNode.createElement('div');
    wrap.className = `cb-board-view ${className}`;
    const toolbar = documentNode.createElement('div');
    toolbar.className = 'cb-edit-toolbar';
    toolbar.dataset.cardEditToolbar = '';
    toolbar.hidden = true;
    const host = documentNode.createElement('div');
    host.className = 'cb-board-host';
    wrap.append(toolbar, host);
    return { wrap, toolbar, host };
  }

  function createController({ host, toolbar = null, boardId, autoPlace = true }) {
    return cardBoardController.create({
      container: host,
      toolbar,
      boardId,
      autoPlace,
      adapter: adapterForMainWindow(),
      escapeHtml: current?.escapeHtml || ((value) => String(value)),
      translate: (key) => current?.translate?.(key) || key,
      onDocument: syncDocument,
      onEditingChange: syncManageButton,
      externalDropTargets: boardId === 'connect' ? [] : [{
        selector: '.nav[data-page="connect"]',
        boardId: 'connect',
      }],
      toast: (message, tone) => globalScope?.dispatchEvent?.(new CustomEvent('card-board-toast', {
        detail: { message, tone },
      })),
    });
  }

  function ensureControllers(container) {
    if (catalogController || !documentNode) return;
    const catalog = createBoardHost('cb-catalog-board');
    const personal = createBoardHost('cb-personal-board');
    catalogWrap = catalog.wrap;
    personalWrap = personal.wrap;
    container.replaceChildren(catalog.wrap, personal.wrap);
    catalogController = createController({ host: catalog.host, toolbar: catalog.toolbar, boardId: 'browser-catalog' });
    personalController = createController({ host: personal.host, toolbar: personal.toolbar, boardId: 'browser-personal' });
    const connectHost = documentNode.getElementById('connectCardBoardHost');
    if (connectHost) connectController = createController({ host: connectHost, boardId: 'connect', autoPlace: false });
    Promise.all([catalogController.load(), personalController.load(), connectController?.load()])
      .then((documents) => syncDocument(documents.find((document) => document?.schemaVersion === 1)))
      .catch(() => {});
  }

  function performRender() {
    if (!current || !started) return;
    const { container, resources, groups, query, translate } = current;
    ensureControllers(container);
    const official = officialCategoryProjection(resources, translate);
    const personal = personalCategoryProjection(resources, groups, translate);
    catalogController.setData({ categories: official, query });
    personalController.setData({ categories: personal, query });
    connectController?.setData({ categories: [...official, ...personal], query: '' });
    const categories = currentView === 'personal' ? personal : official;
    const summary = documentNode.getElementById('categoryLayoutSummary');
    if (summary) summary.textContent = categories.length
      ? translate('browser.categoryCount', { count: categories.length }) : '';
    syncSourceTabs();
  }

  function selectView(view, { focus = false } = {}) {
    const requested = view === 'personal' ? 'personal' : 'catalog';
    currentView = requested === 'catalog' && !hasOfficialCatalog() ? 'personal' : requested;
    syncSourceTabs({ focus });
    performRender();
    return currentView;
  }

  function render(options = {}) {
    if (!options.container || typeof options.translate !== 'function' || typeof options.escapeHtml !== 'function') {
      throw new TypeError('category board dependencies are incomplete');
    }
    current = options;
    performRender();
  }

  function start({ document } = {}) {
    documentNode = document;
    const container = documentNode?.getElementById('campusResources');
    if (!container) throw new TypeError('category board container is missing');
    started = true;
    documentNode.getElementById('categoryModeCatalog')?.addEventListener('click', () => selectView('catalog'));
    documentNode.getElementById('categoryModePersonal')?.addEventListener('click', () => selectView('personal'));
    documentNode.querySelector('.category-source-tabs')?.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const catalogAvailable = hasOfficialCatalog();
      const view = event.key === 'ArrowLeft' || event.key === 'Home' || !catalogAvailable
        ? (catalogAvailable ? 'catalog' : 'personal') : 'personal';
      selectView(view, { focus: true });
    });
    documentNode.getElementById('manageResources')?.addEventListener('click', () => activeController()?.toggleEdit());
    globalScope?.api?.onCardBoardLayoutChanged?.(syncDocument);
    performRender();
  }

  const api = Object.freeze({
    activeController,
    balancedPartitions,
    getLayoutCapacity,
    officialCategoryProjection,
    personalCategoryProjection,
    render,
    selectView,
    start,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.campusCategoryStacks = api;
})(typeof window !== 'undefined' ? window : null,
  typeof module !== 'undefined' && module.exports ? require('./stacked-card-layout') : globalThis.stackedCardLayout,
  typeof module !== 'undefined' && module.exports ? require('./campus-workspace-model') : globalThis.campusWorkspaceModel,
  typeof module !== 'undefined' && module.exports ? require('./components/card-board/card-board-controller') : globalThis.cardBoardController,
  typeof module !== 'undefined' && module.exports ? require('./components/card-board/card-board-model') : globalThis.cardBoardModel);
