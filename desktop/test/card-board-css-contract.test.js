'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(
  __dirname, '..', 'renderer', 'components', 'card-board', 'card-board.css',
), 'utf8');

test('card-board density is container-driven with a hard two-column ceiling', () => {
  assert.match(css, /\.cb-card-body\s*\{[^}]*container:\s*card-content\s*\/\s*inline-size/su);
  assert.match(css, /\.cb-site-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/su);
  assert.match(css, /@container\s+card-content\s*\(min-width:\s*360px\)\s*\{[\s\S]*?\.cb-site-list\s*\{[^}]*repeat\(2,/u);
  assert.doesNotMatch(css, /\.cb-site-list\s*\{[^}]*repeat\((?:3|4),/u);
});

test('card boards have restrained hover and edit feedback without permanent inner scrolling', () => {
  assert.match(css, /\.cb-card:hover\s*\{[^}]*transform:\s*translateY\(-2px\)/su);
  assert.match(css, /\.cb-card\[data-dragging="true"\]\s*\{[^}]*scale\(\.98\)/su);
  assert.match(css, /data-card-drop-target="stack"[^}]*outline:\s*2px solid #b48927/su);
  assert.doesNotMatch(css, /\.cb-(?:card-body|site-list|deck)\s*\{[^}]*overflow-y:\s*(?:auto|scroll)/u,
    'card content must grow into page scrolling instead of nesting a permanent scrollbar');
});

test('a card stack exposes layered headers and a distinct drawn front card', () => {
  assert.match(css,
    /\.cb-deck\.is-stacked \.cb-card \+ \.cb-card\s*\{[^}]*margin-top:\s*-\d+px/su,
    'stack members are still ordinary vertical rows');
  assert.match(css, /\.cb-card\.is-front\s*\{[^}]*z-index:\s*\d+/su);
  assert.match(css, /\.cb-card\[data-stack-depth="5"\]\s*\{[^}]*--cb-stack-inset:\s*10px/su);
  assert.match(css, /\.cb-card-header\.is-draggable\s*\{[^}]*cursor:\s*grab/su);
  assert.doesNotMatch(css, /\.cb-drag-handle\s*\{/u,
    'the obsolete tiny drag handle is still a first-class visual control');
});

test('card color is restrained to bounded category tones on white surfaces', () => {
  for (const tone of ['blue', 'teal', 'gold', 'violet', 'slate']) {
    assert.match(css, new RegExp(`data-card-tone="${tone}"`, 'u'));
  }
  assert.match(css, /\.cb-card-header\s*\{[^}]*linear-gradient\([^)]*#fff[^}]*--cb-tone-wash/su);
  assert.match(css, /\.cb-category-icon\s*\{[^}]*color:\s*var\(--cb-tone\)[^}]*background:\s*var\(--cb-tone-soft\)/su);
});

test('compact website rows retain the approved icon and text density', () => {
  assert.match(css, /\.cb-site\s*\{[^}]*min-height:\s*54px/su);
  assert.match(css, /\.cb-site-icon\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/su);
  assert.match(css, /\.cb-site-icon svg\s*\{[^}]*width:\s*16px[^}]*height:\s*16px/su);
  assert.match(css, /\.cb-site-copy strong\s*\{[^}]*-webkit-line-clamp:\s*2/su);
});

test('Reduced Motion removes card position animation without hiding state', () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.cb-card,[\s\S]*?\.cb-card-body\s*\{[^}]*animation:\s*none\s*!important[^}]*transition-duration:\s*\.01ms\s*!important/su);
});
