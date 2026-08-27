'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { renderStudentHome } = require('../renderer/student-home');

const resources = [
  { id: 'home', name: 'Home', description: 'School', url: 'https://example.edu/', route: 'campus', category: 'common', keywords: [], favorite: true, lastOpenedAt: 10, reviewed: true, builtin: true },
  { id: 'mail', name: 'Mail', description: 'Public', url: 'https://mail.example/', route: 'direct', category: 'common', keywords: [], favorite: false, lastOpenedAt: 20 },
  { id: 'library', name: 'Library', description: 'Books', url: 'https://library.example.edu/', route: 'campus', category: 'academic', keywords: [], favorite: false, lastOpenedAt: null, reviewed: true, builtin: true },
];

const translate = (key) => key;
const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');

test('ordinary Student Home renders unique favorites recent and recommendations', () => {
  const view = renderStudentHome({
    resources, query: '', view: 'all', expanded: false,
    layout: { mode: 'compact', columns: 2, sectionLimit: 4 }, translate, escapeHtml,
  });
  assert.match(view.html, /resources\.favoritesSection/u);
  assert.match(view.html, /resources\.recentSection/u);
  assert.match(view.html, /resources\.recommendedSection/u);
  assert.match(view.html, /data-campus-id="home"/u);
  assert.equal((view.html.match(/data-campus-id="home"/gu) || []).length, 1);
  assert.equal((view.html.match(/data-campus-id="mail"/gu) || []).length, 1);
  assert.equal((view.html.match(/data-campus-id="library"/gu) || []).length, 1);
  assert.doesNotMatch(view.html, /resources\.sourceReviewed|resources\.sourceLocal/u);
  assert.doesNotMatch(view.html, /class="resource-desc"/u);
  assert.match(view.html, /class="resource-icon resource-icon-services"/u);
  assert.match(view.html, /class="resource-icon resource-icon-learning"/u);
  assert.match(view.html, /class="resource-copy"/u);
  assert.match(view.html, /resource-section-favorites/u);
  assert.match(view.html, /resource-route-short/u);
  assert.doesNotMatch(view.html, /<img/u);
  assert.equal(view.hasMore, true);
});

test('ordinary Student Home increases each section budget with the container layout', () => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    ...resources[0], id: `favorite-${index}`, name: `Favorite ${index}`, favorite: true,
    lastOpenedAt: null, reviewed: false, builtin: false,
  }));
  const compact = renderStudentHome({
    resources: many, query: '', view: 'all', expanded: false,
    layout: { mode: 'compact' }, translate, escapeHtml,
  });
  const wide = renderStudentHome({
    resources: many, query: '', view: 'all', expanded: false,
    layout: { mode: 'wide' }, translate, escapeHtml,
  });
  assert.equal((compact.html.match(/data-campus-id=/gu) || []).length, 4);
  assert.equal((wide.html.match(/data-campus-id=/gu) || []).length, 8);
});

test('expanded Student Home replaces curated sections with one complete service grid', () => {
  const view = renderStudentHome({
    resources, query: '', view: 'all', expanded: true,
    layout: { mode: 'wide', columns: 4, sectionLimit: 8 }, translate, escapeHtml,
  });
  assert.match(view.html, /resources\.allSection/u);
  assert.match(view.html, /resource-section-all/u);
  assert.doesNotMatch(view.html, /resources\.favoritesSection|resources\.recentSection/u);
  assert.equal((view.html.match(/data-campus-id=/gu) || []).length, resources.length);
  assert.equal(view.hasMore, true);
});

test('search result mode is bounded and escapes resource markup', () => {
  const view = renderStudentHome({
    resources: [...resources, {
      ...resources[0], id: 'unsafe', name: '<img>', url: 'https://unsafe.example/',
      category: 'x\" onmouseover=\"bad', favorite: false,
    }],
    query: 'img', view: 'all', expanded: true, translate, escapeHtml,
  });
  assert.match(view.html, /resources\.results/u);
  assert.match(view.html, /&lt;img>/u);
  assert.doesNotMatch(view.html, /<img>/u);
  assert.match(view.html, /resource-icon-custom/u);
  assert.doesNotMatch(view.html, /onmouseover/u);
});

test('empty search offers local recovery actions without opening a network target', () => {
  const view = renderStudentHome({
    resources, query: 'does-not-exist', view: 'all', expanded: false,
    layout: { mode: 'compact' }, translate, escapeHtml,
  });
  assert.match(view.html, /data-resource-empty-action="clear"/u);
  assert.match(view.html, /data-resource-empty-action="manage"/u);
  assert.doesNotMatch(view.html, /data-resource-action="open"/u);
});
