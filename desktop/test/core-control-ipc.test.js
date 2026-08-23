'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  campusOpenRequestFromIpc,
  registerCoreControlIpc,
} = require('../lib/core-control-ipc');

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
    connect: operation('connect'),
    disconnect: operation('disconnect'),
    reconnect: operation('reconnect'),
    sshConfig: operation('ssh'),
    copyClashNode: operation('clash'),
    getLogs: operation('logs'),
    openLog: operation('open-log'),
    copyText: operation('copy'),
    openCampusBrowser: operation('browser'),
    checkUpdate: operation('update'),
    openExternal: operation('external'),
    resize: operation('resize'),
  });
  return { calls, handlers };
}

test('core facade registers the exact narrow control channels', () => {
  const f = fixture();
  assert.deepEqual([...f.handlers.keys()], [
    'get-state', 'connect', 'disconnect', 'reconnect', 'ssh-config',
    'copy-clash-node', 'get-logs', 'open-log', 'copy', 'open-campus-browser',
    'check-update', 'open-external', 'resize',
  ]);
});

test('Campus Browser IPC accepts only bounded URL/route fields', () => {
  assert.deepEqual(campusOpenRequestFromIpc({ url: 'https://x.test', route: 'direct' }), {
    url: 'https://x.test', route: 'direct',
  });
  assert.equal(campusOpenRequestFromIpc('https://x.test'), 'https://x.test');
  assert.throws(() => campusOpenRequestFromIpc({ url: '', token: 'forbidden' }), /未知字段/);
  assert.throws(() => campusOpenRequestFromIpc({ url: '', route: 'fallback' }), /路径/);
});

test('copy, update, external and resize reject malformed renderer values', () => {
  const f = fixture();
  assert.throws(() => f.handlers.get('copy')({}, 'x'.repeat(16 * 1024 + 1)), /无效/);
  assert.throws(() => f.handlers.get('check-update')({}, 'true'), /参数/);
  assert.throws(() => f.handlers.get('open-external')({}, ''), /无效/);
  assert.throws(() => f.handlers.get('resize')({}, Number.NaN), /尺寸/);
  f.handlers.get('copy')({}, 'safe');
  f.handlers.get('open-campus-browser')({}, { url: '', route: 'campus' });
  assert.deepEqual(f.calls.filter(([name]) => name === 'copy' || name === 'browser'), [
    ['copy', 'safe'],
    ['browser', { url: '', route: 'campus' }],
  ]);
});
