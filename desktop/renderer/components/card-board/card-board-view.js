(function initializeCardBoardView(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.cardBoardView = api;
})(typeof self !== 'undefined' ? self : globalThis, function cardBoardViewFactory() {
  'use strict';

  function siteIcon(resource) {
    const category = String(resource?.category || 'custom');
    const paths = category === 'learning' || category === 'courses'
      ? '<path d="M4 6h6.5A2.5 2.5 0 0 1 13 8.5V19a2.5 2.5 0 0 0-2.5-2.5H4zM20 6h-4.5A2.5 2.5 0 0 0 13 8.5V19a2.5 2.5 0 0 1 2.5-2.5H20z"/>'
      : '<rect x="5" y="5" width="5" height="5"/><rect x="14" y="5" width="5" height="5"/><rect x="5" y="14" width="5" height="5"/><rect x="14" y="14" width="5" height="5"/>';
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  }

  function categoryIcon(kind) {
    if (kind === 'user-collection') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l1.7 2H20.5v9.5h-17z"/></svg>';
    }
    if (kind === 'system-widget') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8M12 8v8"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>';
  }

  function label(strings, key, fallback) {
    return strings?.[key] || fallback;
  }

  function cardTone(kind) {
    return kind === 'system-widget' ? 'gold' : 'brand';
  }

  function renderSiteRows(items, options) {
    const { escapeHtml: esc, translate, expandedAll = false } = options;
    const visible = expandedAll ? items : items.slice(0, 12);
    if (!visible.length) {
      return `<p class="cb-empty">${esc(label(options.strings, 'emptyCategory', '此分类暂无网站'))}</p>`;
    }
    const rows = visible.map((resource) => {
      const route = resource.route === 'direct'
        ? translate('resources.routeDirect') : translate('resources.routeCampus');
      const favorite = resource.favorite === true;
      const favoriteLabel = translate(favorite ? 'resources.unfavorite' : 'resources.favorite');
      return `<div class="cb-site" data-card-resource-id="${esc(resource.id)}" data-campus-id="${esc(resource.id)}">`
        + `<button class="cb-site-open" type="button" data-resource-action="open" title="${esc(resource.name)}">`
        + `<span class="cb-site-icon">${siteIcon(resource)}</span><span class="cb-site-copy">`
        + `<strong>${esc(resource.name)}</strong><small>${esc(route)}</small></span></button>`
        + `<button class="resource-favorite${favorite ? ' active' : ''}" type="button" data-resource-action="favorite" title="${esc(favoriteLabel)}" aria-label="${esc(favoriteLabel)}" aria-pressed="${favorite}">${favorite ? '★' : '☆'}</button></div>`;
    }).join('');
    const more = items.length > 12 && !expandedAll
      ? `<button class="cb-expand-all" type="button" data-card-action="expand-all">${esc(label(options.strings, 'expandAll', `展开全部（${items.length}）`).replace('{count}', String(items.length)))}</button>`
      : '';
    return rows + more;
  }

  function renderPlacement(placement, card, context) {
    const esc = context.escapeHtml;
    const expanded = context.expandedPlacementId === placement.placementId;
    const front = context.frontPlacementId === placement.placementId;
    const bodyId = `card-board-body-${placement.placementId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    const count = Array.isArray(card?.items) ? card.items.length : 0;
    const kind = placement.card.kind;
    const tone = cardTone(kind);
    const pinned = context.pinnedCardKeys?.has(`${kind}:${placement.card.id}`) === true;
    const canPin = placement.boardId !== 'connect' && kind !== 'system-widget' && !pinned;
    const removeLabel = placement.boardId === 'connect'
      ? label(context.strings, 'removeFromConnect', '从连接页移除')
      : label(context.strings, 'hideCard', '从当前页面隐藏');
    const nextSize = placement.size === 'small' ? 'medium' : placement.size === 'medium' ? 'large' : 'small';
    const cardName = card?.name || placement.card.id;
    const editControls = context.editing
      ? `<div class="cb-card-edit-controls" data-card-edit-controls>`
        + `<button class="cb-icon-action" type="button" data-card-edit-action="resize" data-card-next-size="${nextSize}" aria-label="${esc(label(context.strings, 'resizeCard', '调整卡片尺寸'))}" title="${esc(label(context.strings, 'resizeCard', '调整卡片尺寸'))}">↔</button>`
        + (canPin ? `<button class="cb-icon-action" type="button" data-card-edit-action="pin" aria-label="${esc(label(context.strings, 'pinToConnect', '固定到连接页'))}" title="${esc(label(context.strings, 'pinToConnect', '固定到连接页'))}">⌂</button>` : '')
        + `<button class="cb-icon-action" type="button" data-card-edit-action="remove" aria-label="${esc(removeLabel)}" title="${esc(removeLabel)}">×</button></div>`
      : '';
    const dragLabel = esc(label(context.strings, 'dragCard', '拖动卡片'));
    const depth = Math.max(0, Number(context.stackDepth) || 0);
    return `<article class="cb-card${expanded ? ' is-expanded' : ''}${front ? ' is-front' : ''}" role="group"`
      + ` data-card-placement-id="${esc(placement.placementId)}" data-card-ref-kind="${esc(kind)}"`
      + ` data-card-ref-id="${esc(placement.card.id)}" data-card-size="${esc(placement.size)}"`
      + ` data-card-tone="${tone}"`
      + ` data-expanded="${expanded}" data-card-front="${front}" data-dragging="false"`
      + ` data-stack-depth="${Math.min(depth, 5)}"`
      + (context.editing ? ` draggable="true" tabindex="0" data-card-drag-handle aria-label="${dragLabel}"` : '')
      + `><header class="cb-card-header${context.editing ? ' is-draggable' : ''}">`
      + `<button class="cb-card-toggle" type="button" data-card-action="toggle"`
      + ` aria-expanded="${expanded}" aria-controls="${bodyId}">`
      + `<span class="cb-category-icon">${categoryIcon(kind)}</span><span class="cb-card-title">${esc(cardName)}</span>`
      + `<span class="cb-card-count" aria-label="${esc(String(count))}">${count}</span></button>${editControls}</header>`
      + `<div id="${bodyId}" class="cb-card-body" ${expanded ? '' : 'hidden'}>`
      + `<div class="cb-site-list">${renderSiteRows(card?.items || [], {
        ...context,
        expandedAll: context.expandedAll?.has(placement.placementId),
      })}</div></div>`
      + (context.editing ? '<div class="cb-drop-zones" aria-hidden="true"><span data-card-drop="before"></span><span data-card-drop="stack"></span><span data-card-drop="after"></span></div>' : '')
      + '</article>';
  }

  function renderDeck(unit, cardsByKey, context) {
    const deckId = unit.deck?.deckId || unit.unitId;
    const requestedFront = context.frontByDeck[deckId]
      || context.expandedByDeck[deckId]
      || unit.deck?.activePlacementId
      || unit.placements.at(-1)?.placementId
      || null;
    const frontPlacementId = unit.placements.some(({ placementId }) => placementId === requestedFront)
      ? requestedFront : unit.placements.at(-1)?.placementId || null;
    const activePlacementId = context.expandedByDeck[deckId]
      || (unit.automatic ? null : unit.deck?.activePlacementId) || null;
    const placements = unit.placements.map((placement, index) => {
      const card = cardsByKey.get(`${placement.card.kind}:${placement.card.id}`);
      return renderPlacement(placement, card, {
        ...context,
        expandedPlacementId: activePlacementId,
        frontPlacementId,
        stackDepth: unit.placements.length - index - 1,
      });
    }).join('');
    const size = unit.placements.find(({ placementId }) => placementId === activePlacementId)?.size
      || unit.placements[0]?.size || 'small';
    return `<section class="cb-deck${unit.placements.length > 1 ? ' is-stacked' : ''}" role="listitem"`
      + ` data-card-deck-id="${context.escapeHtml(deckId)}" data-card-size="${context.escapeHtml(size)}"`
      + ` data-auto-stacked="${unit.automatic === true}" data-stack-count="${unit.placements.length}">${placements}</section>`;
  }

  function renderBoard({ boardId, units, cardsByKey, expandedByDeck = {}, frontByDeck = {}, expandedAll = new Set(), editing = false,
    escapeHtml, translate, strings = {}, columns = 1, rows = 1 } = {}) {
    const context = { boardId, expandedByDeck, frontByDeck, expandedAll, editing, escapeHtml, translate, strings };
    const content = units.map((unit) => renderDeck(unit, cardsByKey, context)).join('');
    const empty = `<div class="cb-board-empty"><strong>${escapeHtml(label(strings, 'emptyBoard', '这里还没有卡片'))}</strong>`
      + `<span>${escapeHtml(label(strings, 'emptyBoardHint', '可在整理模式中恢复或固定卡片。'))}</span></div>`;
    return `<div class="cb-board-grid" role="list" data-card-board data-board-id="${escapeHtml(boardId)}"`
      + ` data-editing="${editing}" data-board-columns="${columns}" data-board-rows="${rows}">${content || empty}</div>`;
  }

  function renderSearch(categories, query, context) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    const sections = categories.map((category) => {
      const groupMatch = category.name.toLocaleLowerCase().includes(needle);
      const items = category.items.filter((resource) => groupMatch || [
        resource.name,
        resource.description,
        resource.url,
        ...(Array.isArray(resource.keywords) ? resource.keywords : []),
      ].some((value) => String(value || '').toLocaleLowerCase().includes(needle)));
      if (!items.length) return '';
      return `<section class="cb-search-section"><h3>${context.escapeHtml(category.name)}<span>${items.length}</span></h3>`
        + `<div class="cb-site-list">${renderSiteRows(items, { ...context, expandedAll: true })}</div></section>`;
    }).join('');
    return `<div class="cb-search-results">${sections || `<div class="cb-board-empty"><strong>${context.escapeHtml(label(context.strings, 'noResults', '没有符合条件的网站'))}</strong></div>`}</div>`;
  }

  return Object.freeze({ cardTone, categoryIcon, renderBoard, renderSearch, renderSiteRows, siteIcon });
});
