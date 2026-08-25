'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'campus-browser.html'), 'utf8');
const js = fs.readFileSync(path.join(renderer, 'campus-browser.js'), 'utf8');

test('browser toolbar exposes the active tab network route', () => {
  assert.match(html, /id="routeSelector"/);
  assert.match(html, /value="campus"/);
  assert.match(html, /value="direct"/);
  assert.match(js, /command\('set-route'/);
  assert.match(html, /id="routeRules"/);
  assert.match(js, /command\('manage-routing-rules'/);
});

test('browser toolbar uses a typed preload channel and never encodes commands in its URL', () => {
  assert.match(js, /window\.campusToolbar\?\.command/);
  assert.match(js, /window\.campusToolbar\?\.onState/);
  assert.doesNotMatch(js, /window\.location\.hash|location\.hash\s*=/);
  const browserSource = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'browser', 'session', 'campus-browser.js'),
    'utf8',
  );
  assert.doesNotMatch(browserSource, /URLSearchParams|parsed\.hash|typeof input === 'string'/);
});

test('production Main points Electron at the packaged toolbar preload', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(
    main,
    /path\.join\(__dirname, 'lib', 'browser', 'toolbar', 'campus-toolbar-contract\.js'\)/u,
  );
  assert.ok(fs.existsSync(
    path.join(__dirname, '..', 'lib', 'browser', 'toolbar', 'campus-toolbar-contract.js'),
  ));
});
