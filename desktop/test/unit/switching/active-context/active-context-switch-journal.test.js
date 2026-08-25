'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  commitActiveContextSwitch,
  createPreparedActiveContextSwitch,
  markActiveContextSwitchReady,
  validateActiveContextSwitchJournal,
} = require('../../../../lib/switching/active-context/active-context-switch-journal');

function key(name, seed) { return `${name}-${String(seed).repeat(32)}`; }

function context({
  profileId = 'school-a',
  profileSeed = '1',
  accountSeed = '2',
  workspaceSeed = '3',
  activeContextEpoch = 5,
} = {}) {
  return {
    profileId,
    profileKey: key('profile', profileSeed),
    profileRevision: 1,
    profileCredentialBindingRevision: 1,
    accountKey: key('account', accountSeed),
    accountRevision: 1,
    accountCredentialRevision: 1,
    workspaceKey: key('workspace', workspaceSeed),
    activeContextEpoch,
  };
}

function receipt(seed) {
  return { present: true, bytes: seed + 20, sha256: seed.toString(16).padStart(64, '0') };
}

function activation(seed) {
  return {
    globalSettings: { before: receipt(seed), after: receipt(seed + 1) },
    destinationWorkspace: { before: receipt(seed + 2), after: receipt(seed + 3) },
  };
}

function profileSwitch(overrides = {}) {
  return {
    from: context(),
    to: context({
      profileId: 'school-b', profileSeed: '4', accountSeed: '5', workspaceSeed: '6',
      activeContextEpoch: 3,
    }),
    engineGeneration: 7,
    activation: activation(1),
    randomBytes: () => Buffer.alloc(16, 0xab),
    now: () => 1_800_000_000_000,
    ...overrides,
  };
}

test('profile switch journal advances one immutable prepared ready committed chain', () => {
  const prepared = createPreparedActiveContextSwitch(profileSwitch());
  assert.equal(prepared.kind, 'profile');
  assert.equal(prepared.nextActiveContextEpoch, 6);
  assert.equal(prepared.outcomes.engine, 'pending');
  assert.equal(Object.isFrozen(prepared.to), true);

  const ready = markActiveContextSwitchReady(prepared, {
    now: () => 1_800_000_000_100,
  });
  assert.equal(ready.state, 'ready');
  assert.deepEqual(ready.outcomes, {
    browserWorkspace: 'closed',
    continuations: 'cancelled',
    engine: 'confirmed',
    proxyAccess: 'revoked',
    serverState: 'cleared',
    destination: 'validated',
  });
  const committed = commitActiveContextSwitch(ready, {
    now: () => 1_800_000_000_200,
  });
  assert.equal(committed.state, 'committed');
  assert.equal(committed.switchId, prepared.switchId);
  assert.equal(committed.committedAt, 1_800_000_000_200);
  assert.throws(() => markActiveContextSwitchReady(ready), /prepared/u);
  assert.throws(() => commitActiveContextSwitch(prepared), /ready/u);
});

test('an Engine-free account switch records not_required and keeps Profile authority exact', () => {
  const from = context();
  const prepared = createPreparedActiveContextSwitch({
    from,
    to: context({ accountSeed: '7', workspaceSeed: '8', activeContextEpoch: 2 }),
    nextActiveContextEpoch: 9,
    engineGeneration: null,
    activation: activation(3),
    randomBytes: () => Buffer.alloc(16, 0xcd),
    now: () => 1_800_000_001_000,
  });
  assert.equal(prepared.kind, 'account');
  assert.equal(prepared.outcomes.engine, 'not_required');
  assert.equal(markActiveContextSwitchReady(prepared, {
    now: () => 1_800_000_001_100,
  }).outcomes.engine, 'not_required');
});

test('switch journal rejects no-op, key reuse, Profile drift and stale epochs', () => {
  const from = context();
  assert.throws(() => createPreparedActiveContextSwitch(profileSwitch({ to: from })),
    /distinct Account/u);
  assert.throws(() => createPreparedActiveContextSwitch(profileSwitch({
    to: { ...context({ accountSeed: '7', workspaceSeed: '8' }), profileRevision: 2 },
  })), /Profile authority/u);
  assert.throws(() => createPreparedActiveContextSwitch(profileSwitch({
    to: context({
      profileId: 'school-b', profileSeed: '1', accountSeed: '5', workspaceSeed: '6',
    }),
  })), /reuse persistent context keys/u);
  assert.throws(() => createPreparedActiveContextSwitch(profileSwitch({
    nextActiveContextEpoch: 5,
  })), /advance every bound context/u);
});

test('activation receipts and exact journal schema fail closed', () => {
  assert.throws(() => createPreparedActiveContextSwitch(profileSwitch({
    activation: {
      ...activation(1),
      globalSettings: { before: receipt(1), after: receipt(1) },
    },
  })), /must change its target/u);
  const prepared = createPreparedActiveContextSwitch(profileSwitch());
  assert.throws(() => validateActiveContextSwitchJournal({ ...prepared, extra: true }),
    /invalid schema/u);
  assert.throws(() => validateActiveContextSwitchJournal({
    ...prepared,
    activation: {
      ...prepared.activation,
      globalSettings: {
        ...prepared.activation.globalSettings,
        after: {
          ...prepared.activation.globalSettings.after,
          sha256: 'A'.repeat(64),
        },
      },
    },
  }), /receipt is invalid/u);
  assert.throws(() => validateActiveContextSwitchJournal({
    ...prepared,
    outcomes: { ...prepared.outcomes, destination: 'validated' },
  }), /outcome is invalid/u);
});

test('switch identity entropy is erased and bounded before persistence', () => {
  const entropy = Buffer.alloc(16, 0xef);
  const prepared = createPreparedActiveContextSwitch(profileSwitch({
    randomBytes: () => entropy,
  }));
  assert.match(prepared.switchId, /^switch-[a-f0-9]{32}$/u);
  assert.equal(entropy.every((value) => value === 0), true);
  assert.throws(() => createPreparedActiveContextSwitch(profileSwitch({
    randomBytes: () => Buffer.alloc(15),
  })), /entropy/u);
});
