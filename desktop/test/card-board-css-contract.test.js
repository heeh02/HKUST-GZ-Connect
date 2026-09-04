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
  assert.match(css, /\.cb-deck\.is-stacked\s*\{[^}]*border:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/su);
  assert.match(css, /\.cb-card:not\(\.is-front\)\s*\{[^}]*background:\s*#fff/su);
  assert.match(css, /\.cb-card\.is-front\s*\{[^}]*z-index:\s*\d+/su);
  assert.match(css, /\.cb-card\.is-front\.is-expanded\s*\{[^}]*0 16px 36px rgba\(10,35,75,\.12\)/su);
  assert.match(css, /\.cb-card\[data-stack-depth="5"\]\s*\{[^}]*--cb-stack-inset:\s*15px/su);
  assert.match(css, /\.cb-card-header\.is-draggable\s*\{[^}]*cursor:\s*grab/su);
  assert.doesNotMatch(css, /\.cb-drag-handle\s*\{/u,
    'the obsolete tiny drag handle is still a first-class visual control');
  assert.match(css, /\.cb-card\s*\{[^}]*border-radius:\s*12px/su);
  assert.match(css, /\.cb-card-chevron\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/su);
});

test('card color is restrained to brand and sparse gold tones on white surfaces', () => {
  for (const tone of ['brand', 'gold']) {
    assert.match(css, new RegExp(`data-card-tone="${tone}"`, 'u'));
  }
  for (const removedTone of ['blue', 'teal', 'violet', 'slate']) {
    assert.doesNotMatch(css, new RegExp(`data-card-tone="${removedTone}"`, 'u'));
  }
  assert.match(css, /\.cb-card-header\s*\{[^}]*background:\s*#fff/su);
  assert.doesNotMatch(css, /--cb-tone-wash/u);
  assert.match(css, /\.cb-category-icon\s*\{[^}]*color:\s*var\(--cb-tone\)[^}]*background:\s*var\(--cb-tone-soft\)/su);
  assert.match(css, /\.cb-card\.is-front\s*\{[^}]*inset 3px 0 0 var\(--cb-tone\)/su);
  assert.match(css, /\.cb-card:not\(\.is-front\) \.cb-category-icon\s*\{[^}]*color:\s*#60758e[^}]*background:\s*#f3f5f8/su);
});

test('the compact window gets its own card density without changing the shell minimum', () => {
  assert.match(css, /@media\s*\(max-width:\s*560px\)[\s\S]*?\.cb-card-header,[\s\S]*?min-height:\s*40px/u);
  assert.match(css, /@media\s*\(max-width:\s*560px\)[\s\S]*?\.cb-category-icon\s*\{[^}]*width:\s*22px[^}]*height:\s*22px/u);
});

test('Campus Browser removes the redundant surface and keeps compact navigation icon-only', () => {
  const shellCss = require('node:fs').readFileSync(require('node:path').join(
    __dirname, '..', 'renderer', 'styles.css',
  ), 'utf8');
  assert.match(shellCss, /\.category-workspace\s*\{[^}]*padding:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/su);
  assert.match(shellCss, /@media\s*\(max-width:\s*519px\)[\s\S]*?\.nav-label\s*\{[^}]*display:\s*none/u);
  assert.match(shellCss, /@media\s*\(max-width:\s*519px\)[\s\S]*?\.nav::after\s*\{[^}]*content:\s*attr\(title\)/u);
});

test('compact website rows retain the approved icon and text density', () => {
  assert.match(css, /\.cb-site\s*\{[^}]*min-height:\s*54px/su);
  assert.match(css, /\.cb-site-icon\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/su);
  assert.match(css, /\.cb-site-icon svg\s*\{[^}]*width:\s*16px[^}]*height:\s*16px/su);
  assert.match(css, /\.cb-site-copy strong\s*\{[^}]*-webkit-line-clamp:\s*2/su);
});

test('Reduced Motion removes card position animation without hiding state', () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.cb-card,[\s\S]*?\.cb-card-body,[\s\S]*?\.cb-card-chevron\s*\{[^}]*animation:\s*none\s*!important[^}]*transition-duration:\s*\.01ms\s*!important/su);
});
