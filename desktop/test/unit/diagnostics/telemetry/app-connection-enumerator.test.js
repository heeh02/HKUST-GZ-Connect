'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  AppConnectionEnumerator,
  friendlyProcessName,
  parseLsofConnections,
  parseWindowsConnections,
} = require('../../../../lib/diagnostics/telemetry/app-connection-enumerator');

test('lsof parsing counts only exact loopback SOCKS ports and excludes app-owned pids', () => {
  const parsed = parseLsofConnections([
    'p101', 'cChrome', 'n127.0.0.1:50000->127.0.0.1:6180',
    'n127.0.0.1:50001->127.0.0.1:1080',
    'p202', 'chkustgzconnect', 'n127.0.0.1:50002->127.0.0.1:6180',
  ].join('\n'), [6180], new Set([202]));
  assert.equal(parsed.connCount, 1);
  assert.deepEqual([...parsed.perPid], [[101, 1]]);
});

test('macOS enumeration invokes lsof with the exact SOCKS port selector', async () => {
  const calls = [];
  const enumerator = new AppConnectionEnumerator({
    platform: 'darwin',
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === 'lsof') {
        return 'p101\ncChrome\nn127.0.0.1:50000->127.0.0.1:6180\n';
      }
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n';
    },
  });
  const result = await enumerator.list({ ports: [6180], enginePid: 1, appPid: 2 });
  assert.deepEqual(calls[0], [
    'lsof', ['-nP', '-iTCP@127.0.0.1:6180', '-sTCP:ESTABLISHED', '-F', 'pcn'],
  ]);
  assert.deepEqual(result, {
    connCount: 1,
    apps: [{ pid: 101, name: 'Google Chrome', count: 1 }],
  });
});

test('Windows JSON parsing is bounded to valid non-app processes', () => {
  const output = JSON.stringify([
    { Pid: 100, Name: 'msedge', Count: 2 },
    { Pid: 200, Name: 'hkustgzconnect', Count: 3 },
  ]);
  assert.deepEqual(parseWindowsConnections(output, new Set([200])), {
    connCount: 2,
    apps: [{ pid: 100, name: 'Microsoft Edge', count: 2 }],
  });
  assert.deepEqual(parseWindowsConnections('not json'), { connCount: 0, apps: [] });
});

test('friendly names do not label generic Electron helpers as VS Code', () => {
  assert.equal(friendlyProcessName('Code Helper (Renderer)'), 'VS Code');
  assert.equal(friendlyProcessName('Electron Helper'), 'Electron Helper');
  assert.equal(friendlyProcessName('hkustgzconnect Helper'), 'HKUST(GZ) Connect');
});
