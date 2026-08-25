'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ActiveContextLease } = require('../lib/active-context-lease');
const { ActiveContextSwitchBarrier } = require('../lib/active-context-switch-barrier');
const {
  validateActiveContextSwitchJournal,
} = require('../lib/active-context-switch-journal');
const { ActiveContextSwitchSystem } = require('../lib/active-context-switch-system');

function key(name, seed) { return `${name}-${String(seed).repeat(32)}`; }

function context(profileId, profileSeed, accountSeed, workspaceSeed, epoch = 1) {
  return {
    profileId,
    profileKey: key('profile', profileSeed),
    profileRevision: 1,
    profileCredentialBindingRevision: 1,
    accountKey: key('account', accountSeed),
    accountRevision: 1,
    accountCredentialRevision: 1,
    workspaceKey: key('workspace', workspaceSeed),
    activeContextEpoch: epoch,
  };
}

function binding(value) {
  return {
    profileId: value.profileId,
    profileRevision: value.profileRevision,
    accountHandle: `account-${(value.profileId === 'school-a' ? 'a' : 'b').repeat(36)}`,
    activeContextEpoch: value.activeContextEpoch,
  };
}

function receipt(seed) {
  return { present: true, bytes: seed + 200, sha256: seed.toString(16).padStart(64, '0') };
}

function activation(before, after) {
  return {
    globalSettings: { before: before.globalSettings, after: after.globalSettings },
    destinationWorkspace: {
      before: before.destinationWorkspace,
      after: after.destinationWorkspace,
    },
  };
}

class MemoryJournalStore {
  constructor() { this.document = null; }
  read() { return this.document; }
  prepare(value) {
    if (this.document) throw new Error('already exists');
    this.document = validateActiveContextSwitchJournal(value);
    return { prepared: true, durabilityUnconfirmed: false };
  }
  markReady(value) {
    if (this.document?.state !== 'prepared') throw new Error('not prepared');
    this.document = validateActiveContextSwitchJournal(value);
    return { ready: true, durabilityUnconfirmed: false };
  }
  commit(value) {
    if (this.document?.state !== 'ready') throw new Error('not ready');
    this.document = validateActiveContextSwitchJournal(value);
    return { committed: true, durabilityUnconfirmed: false };
  }
  clearCommitted() {
    if (this.document?.state !== 'committed') return false;
    this.document = null;
    return true;
  }
}

function fixture({ proxyRevokes = true } = {}) {
  let active = context('school-a', '1', '2', '3', 1);
  const contexts = {
    'school-a': active,
    'school-b': context('school-b', '4', '5', '6', 1),
  };
  const activeLease = new ActiveContextLease(binding(active));
  const journalStore = new MemoryJournalStore();
  let activationState = {
    globalSettings: receipt(1),
    destinationWorkspace: receipt(2),
  };
  const residue = {
    browser: false,
    boundaryClosed: true,
    auth: false,
    connectivity: false,
    mutations: 0,
    engineGeneration: null,
    proxy: false,
    server: false,
  };
  const calls = [];
  const barrier = new ActiveContextSwitchBarrier({
    invalidateContext: () => { calls.push('invalidate'); return activeLease.invalidate(); },
    suspendBrowser: async () => { calls.push('suspend'); residue.boundaryClosed = true; },
    browserBoundaryClosed: () => residue.boundaryClosed,
    cancelAuth: () => { calls.push('auth'); residue.auth = false; },
    cancelConnectivity: () => { calls.push('connectivity'); residue.connectivity = false; },
    cancelMutations: async () => { calls.push('mutations'); residue.mutations = 0; return true; },
    closeBrowser: async () => { calls.push('browser'); residue.browser = false; },
    browserClosed: () => !residue.browser,
    stopEngine: async (generation) => {
      calls.push('engine');
      if (residue.engineGeneration !== generation) return { ok: false };
      residue.engineGeneration = null;
      return { ok: true, cleanExit: true };
    },
    revokeProxyAccess: async () => {
      calls.push('proxy');
      if (!proxyRevokes) return false;
      residue.proxy = false;
      return true;
    },
    clearServerState: async () => { calls.push('server'); residue.server = false; return true; },
  });
  const activationStore = {
    readState: () => activationState,
    apply(journal) {
      activationState = {
        globalSettings: journal.activation.globalSettings.after,
        destinationWorkspace: journal.activation.destinationWorkspace.after,
      };
      return true;
    },
  };
  const system = new ActiveContextSwitchSystem({
    journalStore,
    activationStore,
    barrier,
    validateSource: (journal) => journal.from.profileId === active.profileId,
    validateDestination: (journal) => JSON.stringify(contexts[journal.to.profileId]) ===
      JSON.stringify(journal.to),
    activateRuntime: (journal) => {
      assert.deepEqual(residue, {
        browser: false,
        boundaryClosed: true,
        auth: false,
        connectivity: false,
        mutations: 0,
        engineGeneration: null,
        proxy: false,
        server: false,
      });
      active = { ...journal.to, activeContextEpoch: journal.nextActiveContextEpoch };
      contexts[active.profileId] = active;
      activeLease.activate(binding(active));
      return true;
    },
  });
  return {
    activeLease,
    calls,
    contexts,
    journalStore,
    residue,
    system,
    active: () => active,
    activationState: () => activationState,
    setActivationState: (value) => { activationState = value; },
  };
}

test('100 complete lifecycle switches leave no old context residue', async () => {
  const value = fixture();
  let receiptSeed = 10;
  for (let index = 0; index < 100; index++) {
    const from = value.active();
    const destinationId = from.profileId === 'school-a' ? 'school-b' : 'school-a';
    const to = value.contexts[destinationId];
    const staleToken = value.activeLease.captureContext();
    const generation = index + 1;
    Object.assign(value.residue, {
      browser: true,
      boundaryClosed: false,
      auth: true,
      connectivity: true,
      mutations: 2,
      engineGeneration: generation,
      proxy: true,
      server: true,
    });
    const after = {
      globalSettings: receipt(receiptSeed++),
      destinationWorkspace: receipt(receiptSeed++),
    };
    const result = await value.system.begin({
      from,
      to,
      nextActiveContextEpoch: index + 2,
      engineGeneration: generation,
      activation: activation(value.activationState(), after),
    });
    assert.equal(result.activeContextEpoch, index + 2);
    assert.equal(value.activeLease.isContextCurrent(staleToken), false);
    assert.equal(value.journalStore.read(), null);
  }
  assert.equal(value.active().activeContextEpoch, 101);
  assert.equal(value.calls.filter((name) => name === 'engine').length, 100);
  assert.equal(value.calls.filter((name) => name === 'proxy').length, 100);
});

test('proxy revocation failure leaves prepared journal and destination inactive', async () => {
  const value = fixture({ proxyRevokes: false });
  Object.assign(value.residue, {
    browser: true,
    boundaryClosed: false,
    auth: true,
    connectivity: true,
    mutations: 1,
    engineGeneration: 7,
    proxy: true,
    server: true,
  });
  const before = value.activationState();
  const after = { globalSettings: receipt(9), destinationWorkspace: receipt(10) };
  await assert.rejects(value.system.begin({
    from: value.active(),
    to: value.contexts['school-b'],
    nextActiveContextEpoch: 2,
    engineGeneration: 7,
    activation: activation(before, after),
  }), (error) => error.code === 'ACTIVE_CONTEXT_SWITCH_PROXY_REVOKE_FAILED');
  assert.equal(value.journalStore.read().state, 'prepared');
  assert.deepEqual(value.activationState(), before);
  assert.equal(value.activeLease.snapshot(), null);
});

test('system rejects incomplete composition instead of weakening a lifecycle step', () => {
  assert.throws(() => new ActiveContextSwitchSystem(), /journal store/u);
  assert.throws(() => new ActiveContextSwitchSystem({
    journalStore: new MemoryJournalStore(),
    activationStore: { readState() {}, apply() {} },
    barrier: {},
    validateSource() {},
    validateDestination() {},
    activateRuntime() {},
  }), /cleanup barrier/u);
});
