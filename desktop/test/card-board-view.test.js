'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const test = require('node:test');

const view = require('../renderer/components/card-board/card-board-view');

const escapeHtml = (value) => String(value).replace(/[&<>"']/gu, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const translate = (key) => ({
  'resources.routeDirect': '直连',
  'resources.routeCampus': '校园隧道',
  'resources.favorite': '收藏',
  'resources.unfavorite': '取消收藏',
})[key] || key;

function resource(index) {
  return {
    id: `resource-${index}`,
    name: `Resource ${index}`,
    category: 'courses',
    route: index % 2 ? 'direct' : 'campus',
    favorite: index === 1,
  };
}

function fixture({ editing = false, expandedByDeck = {}, frontByDeck = {} } = {}) {
  const placements = [
    {
      placementId: 'placement_courses', boardId: 'browser-catalog',
      card: { kind: 'official-category', id: 'courses' }, deckId: 'deck-academic',
      order: 0, size: 'medium', hidden: false,
    },
    {
      placementId: 'placement_research', boardId: 'browser-catalog',
      card: { kind: 'official-category', id: 'research' }, deckId: 'deck-academic',
      order: 1, size: 'small', hidden: false,
    },
  ];
  const unit = {
    kind: 'deck', unitId: 'deck-academic', order: 0,
    deck: {
      deckId: 'deck-academic', boardId: 'browser-catalog',
      placementIds: placements.map(({ placementId }) => placementId),
      activePlacementId: 'placement_courses', order: 0,
    },
    placements,
  };
  const cardsByKey = new Map([
    ['official-category:courses', { name: '课程、选课与成绩', items: Array.from({ length: 13 }, (_, index) => resource(index)) }],
    ['official-category:research', { name: '科研、进度与计算', items: [resource(20)] }],
  ]);
  return view.renderBoard({
    boardId: 'browser-catalog', units: [unit], cardsByKey,
    expandedByDeck, frontByDeck, editing, escapeHtml, translate, columns: 2,
  });
}

function placementMarkup(markup, placementId) {
  const start = markup.indexOf(`data-card-placement-id="${placementId}"`);
  const next = markup.indexOf('data-card-placement-id="', start + 1);
  return markup.slice(start, next < 0 ? markup.length : next);
}

test('board view exposes semantic board, deck, placement, and toggle state', () => {
  const markup = fixture();
  assert.match(markup, /role="list"[^>]*data-card-board[^>]*data-board-id="browser-catalog"/u);
  assert.equal((markup.match(/role="listitem"/gu) || []).length, 1);
  assert.equal((markup.match(/data-card-placement-id=/gu) || []).length, 2);
  assert.match(markup, /data-card-ref-kind="official-category"/u);
  const courses = placementMarkup(markup, 'placement_courses');
  const research = placementMarkup(markup, 'placement_research');
  assert.match(courses, /data-expanded="true"/u);
  assert.match(courses, /data-card-action="toggle" aria-expanded="true"/u);
  assert.match(markup, /class="cb-card is-expanded is-front"[^>]*data-card-placement-id="placement_courses"/u);
  assert.ok(markup.indexOf('data-card-placement-id="placement_courses"') <
    markup.indexOf('data-card-placement-id="placement_research"'),
  'the front card was moved to the bottom instead of expanding at its original position');
  assert.match(research, /data-expanded="false"/u);
  assert.match(research, /data-card-action="toggle" aria-expanded="false"/u);
  assert.match(research, /class="cb-card-body" hidden/u);
});

test('changing the active card expands it at the same stack position and collapses its sibling', () => {
  const markup = fixture({
    expandedByDeck: { 'deck-academic': 'placement_research' },
    frontByDeck: { 'deck-academic': 'placement_research' },
  });
  const courses = placementMarkup(markup, 'placement_courses');
  const research = placementMarkup(markup, 'placement_research');
  assert.match(courses, /data-expanded="false"/u);
  assert.match(courses, /class="cb-card-body" hidden/u);
  assert.match(research, /data-expanded="true"/u);
  assert.doesNotMatch(research, /class="cb-card-body" hidden/u);
  assert.ok(markup.indexOf('data-card-placement-id="placement_courses"') <
    markup.indexOf('data-card-placement-id="placement_research"'),
  'drawing a card changed the persisted visual order');
  assert.match(markup, /class="cb-card is-expanded is-front"[^>]*data-card-placement-id="placement_research"/u);
});

test('editing adds drag/menu/drop affordances while browsing leaves no draggable target', () => {
  const browsing = fixture({ editing: false });
  assert.doesNotMatch(browsing, /data-card-drag-handle|data-card-drop=/u);
  const editing = fixture({ editing: true });
  assert.equal((editing.match(/data-card-drag-handle/gu) || []).length, 2);
  assert.doesNotMatch(editing, />⠿<\/button>/u,
    'editing still requires a tiny drag-handle button instead of dragging the card');
  assert.equal((editing.match(/class="cb-card-header is-draggable"/gu) || []).length, 2);
  assert.equal((editing.match(/data-card-drop="before"/gu) || []).length, 2);
  assert.equal((editing.match(/data-card-drop="stack"/gu) || []).length, 2);
  assert.equal((editing.match(/data-card-drop="after"/gu) || []).length, 2);
  assert.match(editing, /data-card-edit-action="pin"/u);
});

test('large categories show twelve sites before explicit expansion and keep ID-only actions', () => {
  const markup = fixture();
  const courses = placementMarkup(markup, 'placement_courses');
  assert.equal((courses.match(/data-card-resource-id=/gu) || []).length, 12);
  assert.match(courses, /data-card-action="expand-all"/u);
  assert.doesNotMatch(courses, /https?:\/\//u);

  const expanded = view.renderSiteRows(Array.from({ length: 13 }, (_, index) => resource(index)), {
    escapeHtml, translate, expandedAll: true,
  });
  assert.equal((expanded.match(/data-card-resource-id=/gu) || []).length, 13);
  assert.doesNotMatch(expanded, /data-card-action="expand-all"/u);
});

test('card and website labels are escaped at the view boundary', () => {
  const markup = view.renderSiteRows([{
    id: 'unsafe', name: '<img src=x onerror=alert(1)>', category: 'custom',
    route: 'direct', favorite: false,
  }], { escapeHtml, translate, expandedAll: true });
  assert.doesNotMatch(markup, /<img/u);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/u);
});

test('stack depth uses a bounded data attribute instead of CSP-blocked inline style', () => {
  const markup = fixture();
  assert.match(markup, /data-stack-depth="[01]"/u);
  assert.doesNotMatch(markup, /\sstyle=/u);
});

test('45 reviewed sites across 12 categories stay within the projection budget', () => {
  const placements = Array.from({ length: 12 }, (_, index) => ({
    placementId: `placement-${index}`,
    boardId: 'browser-catalog',
    card: { kind: 'official-category', id: `category-${index}` },
    deckId: null,
    order: index,
    size: 'small',
    hidden: false,
  }));
  const units = placements.map((placement) => ({
    kind: 'placement', unitId: placement.placementId, deck: null,
    placements: [placement], order: placement.order,
  }));
  const cardsByKey = new Map(placements.map((placement, categoryIndex) => [
    `official-category:category-${categoryIndex}`,
    {
      name: `Category ${categoryIndex}`,
      items: Array.from({ length: categoryIndex < 9 ? 4 : 3 }, (_, itemIndex) => (
        resource(categoryIndex * 10 + itemIndex)
      )),
    },
  ]));
  // Warm the renderer factory so the assertion measures the steady-state local projection.
  view.renderBoard({
    boardId: 'browser-catalog', units, cardsByKey, escapeHtml, translate, columns: 3,
  });
  const started = performance.now();
  const markup = view.renderBoard({
    boardId: 'browser-catalog', units, cardsByKey, escapeHtml, translate, columns: 3,
  });
  const elapsed = performance.now() - started;
  assert.equal((markup.match(/data-card-resource-id=/gu) || []).length, 45);
  assert.ok(elapsed < 50, `card-board projection took ${elapsed.toFixed(2)}ms (budget: 50ms)`);
});
