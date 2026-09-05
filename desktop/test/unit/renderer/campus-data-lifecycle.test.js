'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../../../renderer/campus-data-modules');

function fixture(api = {}) {
  const events = new Map();
  const timers = new Map();
  let publications = 0;
  const feature = create({
    document: {
      getElementById: () => null, documentElement: { lang: 'en' },
      addEventListener: (type, fn) => { events.set(fn, type); },
      removeEventListener: (type, fn) => { assert.equal(events.get(fn), type); events.delete(fn); },
    },
    api, translate: key => key, escapeHtml: text => text, openDeepLink: () => {},
    onCatalog: () => { publications += 1; }, now: () => 1_800_000_000_000,
    setTimeout: (fn, delay) => { timers.set(fn, delay); return fn; },
    clearTimeout: id => timers.delete(id),
  });
  return { feature, events, timers, publications: () => publications };
}

test('start is idempotent and dispose permanently releases listeners and timers', async () => {
  const f = fixture({ getCampusData: async () => ({ sessionState: 'authenticated', modules: {} }) });
  f.feature.start(); f.feature.start();
  assert.equal(f.events.size, 1);
  await f.feature.ensureLoaded();
  assert.equal(f.timers.size, 1);
  f.feature.dispose(); f.feature.dispose();
  assert.equal(f.events.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.feature.snapshot(), null);
  assert.equal(f.feature.start(), false);
  assert.equal(await f.feature.ensureLoaded(), null);
});

test('late data cannot publish or reschedule after disposal', async () => {
  let resolve;
  const f = fixture({ getCampusData: () => new Promise(done => { resolve = done; }) });
  const pending = f.feature.load();
  f.feature.dispose();
  resolve({ sessionState: 'authenticated', modules: {}, catalog: {} });
  assert.equal(await pending, null);
  assert.equal(f.publications(), 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.feature.snapshot(), null);
});
