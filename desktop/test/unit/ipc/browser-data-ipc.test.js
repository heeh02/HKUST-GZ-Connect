'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerBrowserDataIpc } = require('../../../lib/ipc/browser-data-ipc');

test('browser data IPC keeps campus snapshots value-free and separate from clearing', async () => {
  const handlers = new Map();
  const calls = [];
  registerBrowserDataIpc({
    register: (channel, handler) => handlers.set(channel, handler),
    clearSiteData: async () => true,
    translate: (key) => key,
    campusData: {
      snapshot: async (options) => {
        calls.push(options || null);
        return { schemaVersion: 1 };
      },
      refreshSchedule: async () => {
        calls.push({ moduleId: 'schedule' });
        return { schemaVersion: 1 };
      },
      scheduleWeek: async options => { calls.push(options); return { schemaVersion: 1 }; },
    },
  });
  assert.deepEqual([...handlers.keys()], [
    'clear-browser-data', 'get-campus-data', 'refresh-campus-data', 'refresh-campus-schedule', 'get-campus-schedule-week',
  ]);
  assert.deepEqual(await handlers.get('get-campus-data')({}), { schemaVersion: 1 });
  assert.deepEqual(await handlers.get('refresh-campus-data')({}), { schemaVersion: 1 });
  assert.deepEqual(await handlers.get('refresh-campus-schedule')({}), { schemaVersion: 1 });
  assert.deepEqual(calls, [null, { force: true }, { moduleId: 'schedule' }]);
  assert.throws(() => handlers.get('get-campus-data')({}, { url: 'https://evil.example' }), /value-free/u);
  assert.throws(() => handlers.get('refresh-campus-data')({}, 'schedule'), /value-free/u);
  assert.throws(() => handlers.get('refresh-campus-schedule')({}, { force: true }), /value-free/u);
  await handlers.get('get-campus-schedule-week')({}, { date: '2027-01-13' });
  assert.deepEqual(calls.at(-1), { date: '2027-01-13', force: false });
  assert.throws(() => handlers.get('get-campus-schedule-week')({}, { date: '2027-02-30' }), /invalid/u);
  assert.throws(() => handlers.get('get-campus-schedule-week')({}, { date: '2027-01-13', url: 'https://invalid.example' }), /selection/u);
  assert.throws(() => handlers.get('get-campus-schedule-week')({}, { date: '2027-01-13' }, {}), /one value/u);
});
