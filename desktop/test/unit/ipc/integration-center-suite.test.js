'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createIntegrationTargetSelector,
  selectedIntegrationTargetFile,
} = require('../../../lib/ipc/integration-center-suite');

test('target selector writes only user-selected Clash or Mihomo export files', async () => {
  const calls = [];
  const results = [
    { canceled: false, filePath: '/Users/student/campus.yaml' },
    { canceled: false, filePath: '/Users/student/mihomo.yaml' },
  ];
  const dialog = {
    showSaveDialog: async (...args) => { calls.push(['save', args]); return results.shift(); },
  };
  const select = createIntegrationTargetSelector({
    dialog, getParentWindow: () => null, homeDirectory: '/Users/student',
  });
  assert.equal(await select({ adapterId: 'clash_yaml', action: 'save' }),
    '/Users/student/campus.yaml');
  assert.equal(await select({ adapterId: 'mihomo_yaml', action: 'save' }),
    '/Users/student/mihomo.yaml');
  assert.equal(await select({ adapterId: 'openssh_proxy_command', action: 'install' }), null);
  assert.equal(await select({ adapterId: 'clash_verge_rev_managed', action: 'install' }), null);
  assert.equal(calls[0][1].length, 1, 'dialog without a live parent gets options only');
  assert.equal(calls[1][1][0].defaultPath, '/Users/student/campus-connect-mihomo.yaml');
  assert.equal(calls.every(([method]) => method === 'save'), true);
  assert.equal(selectedIntegrationTargetFile({ canceled: false, filePaths: ['/one', '/two'] }), null);
});
