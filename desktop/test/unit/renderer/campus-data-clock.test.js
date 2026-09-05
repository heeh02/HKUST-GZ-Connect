'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../../../renderer/campus-data-modules.js');

test('injected clock keeps daily cache and manual refresh independent from wall time', async () => {
  let now = new Date(2027, 0, 15, 10).getTime();
  let reads = 0;
  let refreshes = 0;
  let timerId = 0;
  const timers = new Map();
  const snapshot = () => ({ sessionState: 'authenticated', modules: {
    schedule: { state: 'empty', items: [], fetchedAt: now },
  } });
  const feature = create({
    document: { getElementById: () => null, documentElement: { lang: 'en' } },
    api: {
      getCampusData: async () => { reads += 1; return snapshot(); },
      refreshCampusSchedule: async () => { refreshes += 1; return snapshot(); },
    },
    translate: (key) => key, escapeHtml: (text) => text, openDeepLink: () => {},
    now: () => now,
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });
  const day = 86_400_000;
  await feature.ensureLoaded();
  assert.equal(reads, 1);
  assert.equal([...timers.values()][0].delay, day);
  now += day - 1;
  await feature.ensureLoaded();
  assert.equal(refreshes, 0);
  assert.equal(timers.size, 1);
  now += 1;
  await feature.ensureLoaded();
  assert.equal(refreshes, 1);
  await feature.refreshSchedule();
  assert.equal(refreshes, 2);
  assert.equal(reads, 1);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, day);
});
