(function initializeCardBoardView(root, factory) {
  const api = factory(
    typeof module !== 'undefined' && module.exports ? require('./card-board-icons') : root.cardBoardIcons,
    typeof module !== 'undefined' && module.exports ? require('../../campus-search-presenter') : root.campusSearchPresenter,
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.cardBoardView = api;
})(typeof self !== 'undefined' ? self : globalThis, function cardBoardViewFactory(icons, searchPresenter) {
  'use strict';

  if (!icons?.categoryIcon || !icons?.siteIcon || !searchPresenter?.present || !searchPresenter?.highlight) {
    throw new TypeError('card board presentation dependencies are required');
  }

  function label(strings, key, fallback) {
    return strings?.[key] || fallback;
  }

  function cardTone(kind) {
    return kind === 'system-widget' ? 'gold' : 'brand';
  }

  function renderSiteRows(items, options) {
    const { escapeHtml: esc, translate, expandedAll = false } = options;
    const previewLimit = Math.max(1, Math.min(8, Number(options.previewLimit) || 4));
    const visible = expandedAll ? items : items.slice(0, previewLimit);
    if (!visible.length) {
      return `<p class="cb-empty">${esc(label(options.strings, 'emptyCategory', '此分类暂无网站'))}</p>`;
    }
    const rows = visible.map((resource) => {
      const route = resource.route === 'direct'
        ? translate('resources.routeDirect') : translate('resources.routeCampus');
      const favorite = resource.favorite === true;
      const favoriteLabel = translate(favorite ? 'resources.unfavorite' : 'resources.favorite');
      const highlightQuery = resource.searchMatchedTerm || options.searchQuery;
      const name = highlightQuery
        ? searchPresenter.highlight(resource.name, highlightQuery, esc) : esc(resource.name);
      const descriptionText = resource.searchUseCase || resource.description;
      const description = options.showDescription && descriptionText
        ? `<span class="cb-site-description">${searchPresenter.highlight(descriptionText, highlightQuery, esc)}</span>` : '';
      const audience = options.showDescription && resource.searchAudience
        ? `<span class="cb-site-audience">${esc(resource.searchAudience)}</span><span aria-hidden="true"> · </span>` : '';
      return `<div class="cb-site" data-card-resource-id="${esc(resource.id)}" data-campus-id="${esc(resource.id)}">`
        + `<button class="cb-site-open" type="button" data-resource-action="open" title="${esc(resource.name)}">`
        + `<span class="cb-site-icon">${icons.siteIcon(resource)}</span><span class="cb-site-copy">`
        + `<strong>${name}</strong>${description}<small class="cb-site-route ${resource.route === 'direct' ? 'direct' : 'campus'}">${audience}${esc(route)}</small></span></button>`
        + `<button class="resource-favorite${favorite ? ' active' : ''}" type="button" data-resource-action="favorite" title="${esc(favoriteLabel)}" aria-label="${esc(favoriteLabel)}" aria-pressed="${favorite}">${favorite ? '★' : '☆'}</button></div>`;
    }).join('');
    const more = items.length > visible.length && !expandedAll
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
      + `<span class="cb-category-icon">${icons.categoryIcon(kind, placement.card.id)}</span><span class="cb-card-title">${esc(cardName)}</span>`
      + `<span class="cb-card-count" aria-label="${esc(String(count))}">${count}</span>`
      + '<span class="cb-card-chevron" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m7 4 6 6-6 6"/></svg></span>'
      + `</button>${editControls}</header>`
      + `<div id="${bodyId}" class="cb-card-body" ${expanded ? '' : 'hidden'}>`
      + `<div class="cb-site-list">${renderSiteRows(card?.items || [], {
        ...context,
        expandedAll: context.expandedAll?.has(placement.placementId),
        previewLimit: placement.size === 'large' ? 8 : placement.size === 'medium' ? 6 : 4,
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
    const sections = searchPresenter.present(categories, query).map((category) => {
      const items = category.items.map(({ resource, audience, useCase, matchedTerm }) => ({
        ...resource,
        searchAudience: audience,
        searchUseCase: useCase,
        searchMatchedTerm: matchedTerm,
      }));
      return `<section class="cb-search-section"><h3>${searchPresenter.highlight(category.name, query, context.escapeHtml)}<span>${items.length}</span></h3>`
        + `<div class="cb-site-list">${renderSiteRows(items, {
          ...context,
          expandedAll: true,
          searchQuery: query,
          showDescription: true,
        })}</div></section>`;
    }).join('');
    return `<div class="cb-search-results">${sections || `<div class="cb-board-empty"><strong>${context.escapeHtml(label(context.strings, 'noResults', '没有符合条件的网站'))}</strong></div>`}</div>`;
  }

  return Object.freeze({
    cardTone,
    categoryIcon: icons.categoryIcon,
    renderBoard,
    renderSearch,
    renderSiteRows,
    siteIcon: icons.siteIcon,
  });
});
