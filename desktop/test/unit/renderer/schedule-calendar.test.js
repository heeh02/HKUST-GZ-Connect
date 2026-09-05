'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleWeekModel } = require('../../../renderer/campus-data-modules');
const date = (day, hour = 0) => new Date(2027, 0, day, hour).getTime();

test('cross-day events project only onto intersecting calendar dates', () => {
  const entry = { id: 'overnight', startsAt: date(12, 20), endsAt: date(13, 10) };
  const model = scheduleWeekModel([entry], date(13));
  assert.deepEqual(model.events.map(({ day }) => day), [1, 2]);
  assert.deepEqual(model.events.map(({ segmentStart, segmentEnd }) => [segmentStart, segmentEnd]),
    [[date(12, 20), date(13)], [date(13), date(13, 10)]]);
  assert.equal(model.eventCount, 1);
  assert.equal(model.events[0].entry, entry);
  assert.equal(model.slotStart, 0);
  assert.equal(model.slotCount, 12);
  assert.equal(model.events[0].slot, 10);
  assert.equal(model.events[0].span, 2);
  assert.equal(model.events[1].slot, 0);
  assert.equal(model.events[1].span, 5);
});

test('ordinary daytime events retain the compact default time axis', () => {
  const model = scheduleWeekModel([{ startsAt: date(12, 10), endsAt: date(12, 12) }], date(13));
  assert.equal(model.slotStart, 480);
  assert.equal(model.slotCount, 7);
  assert.equal(model.events[0].slot, 1);
});

test('week clipping uses interval intersection, not the original weekday', () => {
  const model = scheduleWeekModel([
    { id: 'previous-week', startsAt: date(10, 20), endsAt: date(11, 10) },
    { id: 'next-week', startsAt: date(17, 20), endsAt: date(18, 10) },
  ], date(13));
  assert.deepEqual(model.events.map(({ day }) => day), [0, 6]);
  assert.equal(model.events[0].segmentStart, date(11));
  assert.equal(model.events[1].segmentEnd, date(18));
});

test('exclusive end midnight creates no extra day and invalid intervals are absent', () => {
  const model = scheduleWeekModel([
    { startsAt: date(12, 20), endsAt: date(13) },
    { startsAt: date(13), endsAt: date(13) },
    { startsAt: date(14), endsAt: date(13) },
    { startsAt: Number.MAX_VALUE, endsAt: Infinity },
  ], date(13));
  assert.equal(model.events.length, 1);
  assert.equal(model.events[0].day, 1);
  assert.equal(model.eventCount, 1);
});
