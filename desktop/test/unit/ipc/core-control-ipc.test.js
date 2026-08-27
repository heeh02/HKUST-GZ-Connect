'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  campusOpenRequestFromIpc,
  registerCoreControlIpc,
  resourceOpenRequestFromIpc,
} = require('../../../lib/ipc/core-control-ipc');

function fixture() {
  const handlers = new Map();
  const calls = [];
  const operation = (name) => (...args) => {
    calls.push([name, ...args]);
    return { ok: true, name };
  };
  registerCoreControlIpc({
    register: (channel, handler) => handlers.set(channel, handler),
    getState: operation('state'),
    getLoginAccount: operation('login-account'),
    connect: operation('connect'),
    disconnect: operation('disconnect'),
    reconnect: operation('reconnect'),
    getLogs: operation('logs'),
    openLog: operation('open-log'),
    copyText: operation('copy'),
    openCampusBrowser: operation('browser'),
    openBookmarkManager: operation('bookmark-manager'),
    openResource: operation('resource'),
    checkUpdate: operation('update'),
    openExternal: operation('external'),
    resize: operation('resize'),
  });
  return { calls, handlers };
}

test('core facade registers the exact narrow control channels', () => {
  const f = fixture();
  assert.deepEqual([...f.handlers.keys()], [
    'get-state', 'get-login-account', 'connect', 'disconnect', 'reconnect',
    'get-logs', 'open-log', 'copy', 'open-campus-browser', 'open-bookmark-manager', 'open-resource',
    'check-update', 'open-external', 'resize',
  ]);
});

test('WebResource open accepts only one bounded opaque ID', () => {
  assert.deepEqual(resourceOpenRequestFromIpc({ resourceId: 'canvas' }), {
    resourceId: 'canvas',
  });
  assert.throws(() => resourceOpenRequestFromIpc({ resourceId: 'canvas', url: 'https://x.test' }), /未知字段/u);
  assert.throws(() => resourceOpenRequestFromIpc({ resourceId: '' }), /校园资源/u);
  const f = fixture();
  f.handlers.get('open-resource')({}, { resourceId: 'canvas' });
  assert.deepEqual(f.calls.find(([name]) => name === 'resource'), [
    'resource', { resourceId: 'canvas' },
  ]);
});

test('Campus Browser URL IPC leaves route authority in Main', () => {
  assert.deepEqual(campusOpenRequestFromIpc(), { url: '' });
  assert.deepEqual(campusOpenRequestFromIpc({ url: 'https://x.test' }), {
    url: 'https://x.test',
  });
  assert.equal(campusOpenRequestFromIpc('https://x.test'), 'https://x.test');
  assert.throws(() => campusOpenRequestFromIpc({ url: '', route: 'direct' }), /未知字段/);
});

test('copy, update, external and resize reject malformed renderer values', () => {
  const f = fixture();
  assert.throws(() => f.handlers.get('copy')({}, 'x'.repeat(16 * 1024 + 1)), /无效/);
  assert.throws(() => f.handlers.get('check-update')({}, 'true'), /参数/);
  assert.throws(() => f.handlers.get('open-external')({}, ''), /无效/);
  assert.throws(() => f.handlers.get('resize')({}, Number.NaN), /尺寸/);
  f.handlers.get('copy')({}, 'safe');
  f.handlers.get('open-campus-browser')({}, { url: '' });
  f.handlers.get('open-bookmark-manager')({});
  assert.deepEqual(f.calls.filter(([name]) => name === 'copy' || name === 'browser'), [
    ['copy', 'safe'],
    ['browser', { url: '' }],
  ]);
  assert.deepEqual(f.calls.find(([name]) => name === 'bookmark-manager'), ['bookmark-manager']);
});
