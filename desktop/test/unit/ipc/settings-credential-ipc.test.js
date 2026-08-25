'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  registerSettingsCredentialIpc,
  settingsPatchFromIpc,
} = require('../../../lib/ipc/settings-credential-ipc');

function fixture(overrides = {}) {
  const handlers = new Map();
  const calls = [];
  let blocked = false;
  let current = {
    username: 'alice',
    port: 1080,
    strictProxyAuth: true,
    language: 'zh',
    customResources: [],
  };
  const runOperations = async (build) => {
    const operations = build();
    calls.push(['operations', operations.resumeBrowser]);
    return operations.commit();
  };
  const dependencies = {
    register: (channel, handler) => handlers.set(channel, handler),
    loadSettings: () => ({ ...current, customResources: [...current.customResources] }),
    saveSettings: (settings) => { current = settings; calls.push(['save', settings]); return settings; },
    savePassword: (password, username) => { calls.push(['password', password, username]); return true; },
    removePassword: () => { calls.push(['remove-password']); return true; },
    runCredentialMutation: ({ mutate }) => {
      try { return { ok: true, value: mutate() }; }
      catch (error) { return { ok: false, error, recovery: { status: 'recovered' } }; }
    },
    credentialJournalPath: '/fixture/credential-transaction.json',
    credentialPaths: {
      settings: '/fixture/settings.json',
      settingsBackup: '/fixture/settings.json.bak',
      credential: '/fixture/credential.bin',
    },
    applyCredentialRecovery: (recovery, options) => {
      calls.push(['recovery', recovery?.status, options]);
      blocked = recovery?.status === 'blocked';
    },
    isCredentialBlocked: () => blocked,
    retryCredentialRecovery: () => { blocked = false; return { status: 'recovered' }; },
    runPolicyTransaction: runOperations,
    runSerialTransaction: runOperations,
    assertPersistence: () => calls.push(['assert-persistence']),
    translate: (key) => key,
    onLanguageChanged: (language) => calls.push(['language', language]),
    setStartAtLogin: (enabled) => calls.push(['login-item', enabled]),
    hasActiveEngine: () => false,
    reconnect: async () => { calls.push(['reconnect']); return { ok: true }; },
    disconnect: async () => { calls.push(['disconnect']); return { ok: true }; },
    ...overrides,
  };
  registerSettingsCredentialIpc(dependencies);
  return {
    calls,
    dependencies,
    handlers,
    get current() { return current; },
    set current(settings) { current = settings; },
    set blocked(value) { blocked = value; },
  };
}

test('IPC patch schema is exact and bounds credentials and route domains', () => {
  assert.deepEqual(settingsPatchFromIpc({ username: 'alice', routeDomains: [' example.test '] }), {
    username: 'alice',
    routeDomains: ['example.test'],
  });
  assert.throws(() => settingsPatchFromIpc({ token: 'forbidden' }), /未知字段/);
  assert.throws(() => settingsPatchFromIpc({ password: 'x'.repeat(4097) }), /无效/);
  assert.deepEqual(settingsPatchFromIpc({ proxyAuthMigrationAcknowledged: true }), {
    proxyAuthMigrationAcknowledged: true,
  });
  assert.throws(
    () => settingsPatchFromIpc({ proxyAuthMigrationAcknowledged: false }),
    /must be true/,
  );
});

test('an inherited compatibility choice can be acknowledged without restarting the Engine', async () => {
  const f = fixture();
  f.current = {
    ...f.current,
    strictProxyAuth: false,
    proxySecurityVersion: 3,
    proxyAuthMigrationPending: true,
  };
  const result = await f.handlers.get('save')({}, { proxyAuthMigrationAcknowledged: true });
  assert.equal(result.ok, true);
  assert.equal(result.settings.strictProxyAuth, false);
  assert.equal(result.settings.proxyAuthMigrationPending, false);
  assert.equal(result.proxyAuthChanged, false);
  assert.equal(f.calls.some(([name]) => name === 'reconnect'), false);
});

test('password save uses the credential transaction and clears every request reference', async () => {
  const f = fixture();
  const payload = { username: 'bob', password: 'synthetic-password' };
  const result = await f.handlers.get('save')({}, payload);
  assert.equal(result.ok, true);
  assert.equal(result.settings.username, 'bob');
  assert.equal(payload.password, '');
  assert.deepEqual(f.calls.filter(([name]) => name === 'password'), [
    ['password', 'synthetic-password', 'bob'],
  ]);
  assert.ok(f.calls.some(([name, status]) => name === 'recovery' && status === 'committed'));
});

test('password plus network policy is rejected before writes and clears the payload', async () => {
  const f = fixture();
  const payload = { password: 'synthetic-password', port: 6180 };
  const result = await f.handlers.get('save')({}, payload);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'error.credentialPolicyCombined');
  assert.equal(payload.password, '');
  assert.equal(f.calls.some(([name]) => name === 'save' || name === 'password'), false);
});

test('policy save rebases in its queue, keeps latest resources, and reconnects current Engine', async () => {
  let f;
  const runPolicyTransaction = async (build) => {
    f.current = {
      ...f.current,
      customResources: [{
        id: 'latest',
        name: 'Latest',
        url: 'https://latest.example.test/',
        description: 'fixture',
        route: 'direct',
      }],
    };
    const operations = build();
    f.calls.push(['resume-browser', operations.resumeBrowser]);
    return operations.commit();
  };
  f = fixture({
    runPolicyTransaction,
    hasActiveEngine: () => true,
  });
  const result = await f.handlers.get('save')({}, { port: 6180 });
  assert.equal(result.ok, true);
  assert.equal(result.reconnected, true);
  assert.equal(result.settings.customResources[0].id, 'latest');
  assert.ok(f.calls.some(([name, value]) => name === 'resume-browser' && value === false));
  assert.ok(f.calls.some(([name]) => name === 'reconnect'));
});

test('language and login-item effects run only after a successful settings commit', async () => {
  const f = fixture();
  const result = await f.handlers.get('save')({}, { language: 'en', startAtLogin: true });
  assert.equal(result.ok, true);
  assert.ok(f.calls.some(([name, value]) => name === 'language' && value === 'en'));
  assert.ok(f.calls.some(([name, value]) => name === 'login-item' && value === true));
});

test('username changes without a password fail and credential recovery errors stay stable', async () => {
  const f = fixture();
  const username = await f.handlers.get('save')({}, { username: 'bob' });
  assert.equal(username.ok, false);
  assert.equal(username.error, 'error.usernameNeedsPassword');

  const failed = fixture({
    runCredentialMutation: () => ({
      ok: false,
      recovery: { status: 'credential-cleared' },
      error: { credentialStoreUnavailable: true },
    }),
  });
  const payload = { password: 'synthetic-password' };
  const result = await failed.handlers.get('save')({}, payload);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'error.settingsSaveFailedPasswordCleared');
  assert.equal(payload.password, '');
});

test('logout stops the Engine then atomically removes credential and username', async () => {
  const f = fixture();
  const result = await f.handlers.get('logout')();
  assert.equal(result.ok, true);
  assert.equal(result.settings.username, '');
  assert.deepEqual(f.calls.filter(([name]) => (
    name === 'disconnect' || name === 'remove-password'
  )), [['disconnect'], ['remove-password']]);
});

test('blocked logout retries recovery and never mutates while the block remains', async () => {
  const f = fixture({ retryCredentialRecovery: () => ({ status: 'blocked' }) });
  f.blocked = true;
  const result = await f.handlers.get('logout')();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'error.credentialRecoveryBlocked');
  assert.equal(f.calls.some(([name]) => name === 'remove-password'), false);
});
