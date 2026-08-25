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
    resources, query: '', view: 'all', expanded: false, translate, escapeHtml,
  });
  assert.match(view.html, /resources\.favoritesSection/u);
  assert.match(view.html, /resources\.recentSection/u);
  assert.match(view.html, /resources\.recommendedSection/u);
  assert.match(view.html, /data-campus-id="home"/u);
  assert.equal((view.html.match(/data-campus-id="home"/gu) || []).length, 1);
  assert.equal((view.html.match(/data-campus-id="mail"/gu) || []).length, 1);
  assert.equal((view.html.match(/data-campus-id="library"/gu) || []).length, 1);
  assert.match(view.html, /resources\.sourceReviewed/u);
  assert.match(view.html, /resources\.sourceLocal/u);
  assert.equal(view.hasMore, false);
});

test('expanded Student Home replaces curated sections with one complete service grid', () => {
  const view = renderStudentHome({
    resources, query: '', view: 'all', expanded: true, translate, escapeHtml,
  });
  assert.match(view.html, /resources\.allSection/u);
  assert.doesNotMatch(view.html, /resources\.favoritesSection|resources\.recentSection/u);
  assert.equal((view.html.match(/data-campus-id=/gu) || []).length, resources.length);
  assert.equal(view.hasMore, true);
});

test('search result mode is bounded and escapes resource markup', () => {
  const view = renderStudentHome({
    resources: [...resources, {
      ...resources[0], id: 'unsafe', name: '<img>', url: 'https://unsafe.example/', favorite: false,
    }],
    query: 'img', view: 'all', expanded: true, translate, escapeHtml,
  });
  assert.match(view.html, /resources\.results/u);
  assert.match(view.html, /&lt;img>/u);
  assert.doesNotMatch(view.html, /<img>/u);
});
