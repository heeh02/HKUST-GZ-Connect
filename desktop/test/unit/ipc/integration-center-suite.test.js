'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createIntegrationTargetSelector,
  createLegacyExternalProxyActions,
  selectedIntegrationTargetFile,
} = require('../../../lib/ipc/integration-center-suite');

test('target selector uses explicit save/open dialogs and returns no guessed managed path', async () => {
  const calls = [];
  const results = [
    { canceled: false, filePath: '/Users/student/campus.yaml' },
    { canceled: false, filePaths: ['/Users/student/.ssh/config'] },
    { canceled: true, filePaths: [] },
  ];
  const dialog = {
    showSaveDialog: async (...args) => { calls.push(['save', args]); return results.shift(); },
    showOpenDialog: async (...args) => { calls.push(['open', args]); return results.shift(); },
  };
  const select = createIntegrationTargetSelector({
    dialog, getParentWindow: () => null, homeDirectory: '/Users/student',
  });
  assert.equal(await select({ adapterId: 'clash_yaml', action: 'save' }),
    '/Users/student/campus.yaml');
  assert.equal(await select({ adapterId: 'openssh_proxy_command', action: 'install' }),
    '/Users/student/.ssh/config');
  assert.equal(await select({ adapterId: 'clash_verge_rev_managed', action: 'install' }), null);
  assert.equal(calls[0][1].length, 1, 'dialog without a live parent gets options only');
  assert.equal(calls[1][1][0].defaultPath, '/Users/student/.ssh/config');
  assert.equal(calls[2][1][0].defaultPath, '/Users/student',
    'portable Clash Verge paths are never guessed');
  assert.equal(selectedIntegrationTargetFile({ canceled: false, filePaths: ['/one', '/two'] }), null);
});

test('legacy actions retain strict credentials in Main callbacks and never return them', async () => {
  const calls = [];
  const credential = {
    withStrings(callback) { return callback('A'.repeat(32), 'B'.repeat(32)); },
  };
  const actions = createLegacyExternalProxyActions({
    getSettings: () => ({ port: 6180 }),
    ensureAccess: (port) => { calls.push(['access', port]); return credential; },
    currentGeneration: () => 7,
    hasActiveEngine: () => true,
    activeAuthentication: () => null,
    reconnect: async () => ({ ok: true }),
    writeClipboard: (text) => calls.push(['clipboard', text]),
    helperPath: () => '/Applications/Campus Connect.app/helper',
    credentialFile: () => '/private/credential',
    profileId: () => 'school-a',
    errorText: () => 'unavailable',
  });
  const ssh = actions.sshConfig();
  assert.match(ssh, /--profile-id "school-a"/u);
  assert.deepEqual(await actions.copyClashNode(), { ok: true });
  assert.ok(calls.some(([name]) => name === 'clipboard'));
  assert.equal(JSON.stringify(await actions.copyClashNode()).includes('B'.repeat(32)), false);
});
