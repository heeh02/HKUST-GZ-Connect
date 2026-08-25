'use strict';

const crypto = require('node:crypto');
const {
  validateOpaqueKey,
  validateProfileId,
} = require('./profiles/schema/school-profile-schema');

const ACTIVE_CONTEXT_SWITCH_JOURNAL_VERSION = 1;
const ACTIVE_CONTEXT_SWITCH_TYPE = 'active_context_switch';
const JOURNAL_STATES = Object.freeze(['prepared', 'ready', 'committed']);
const DIGEST = /^[a-f0-9]{64}$/u;
const MAX_GLOBAL_SETTINGS_BYTES = 512 * 1024;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, name) {
  const source = plainObject(value, name);
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} has an invalid schema`);
  }
  return source;
}

function positive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function nullablePositive(value, name) {
  return value === null ? null : positive(value, name);
}

function timestamp(value, name) {
  return value === null ? null : positive(value, name);
}

function context(value, name) {
  const source = exactKeys(value, [
    'profileId', 'profileKey', 'profileRevision', 'profileCredentialBindingRevision',
    'accountKey', 'accountRevision', 'accountCredentialRevision', 'workspaceKey',
    'activeContextEpoch',
  ], name);
  const result = {
    profileId: validateProfileId(source.profileId),
    profileKey: validateOpaqueKey(source.profileKey, `${name}.profileKey`),
    profileRevision: positive(source.profileRevision, `${name}.profileRevision`),
    profileCredentialBindingRevision: positive(
      source.profileCredentialBindingRevision,
      `${name}.profileCredentialBindingRevision`,
    ),
    accountKey: validateOpaqueKey(source.accountKey, `${name}.accountKey`),
    accountRevision: positive(source.accountRevision, `${name}.accountRevision`),
    accountCredentialRevision: positive(
      source.accountCredentialRevision,
      `${name}.accountCredentialRevision`,
    ),
    workspaceKey: validateOpaqueKey(source.workspaceKey, `${name}.workspaceKey`),
    activeContextEpoch: positive(source.activeContextEpoch, `${name}.activeContextEpoch`),
  };
  if (new Set([result.profileKey, result.accountKey, result.workspaceKey]).size !== 3) {
    throw new TypeError(`${name} persistent keys must be distinct`);
  }
  return Object.freeze(result);
}

function switchKind(from, to) {
  if (from.profileId !== to.profileId) {
    if (from.profileKey === to.profileKey || from.accountKey === to.accountKey ||
        from.workspaceKey === to.workspaceKey) {
      throw new TypeError('profile switch cannot reuse persistent context keys');
    }
    return 'profile';
  }
  if (from.profileKey !== to.profileKey ||
      from.profileRevision !== to.profileRevision ||
      from.profileCredentialBindingRevision !== to.profileCredentialBindingRevision) {
    throw new TypeError('account switch cannot change the Profile authority');
  }
  if (from.accountKey === to.accountKey || from.workspaceKey === to.workspaceKey) {
    throw new TypeError('account switch requires a distinct Account and Workspace');
  }
  return 'account';
}

function receipt(value, name) {
  const source = exactKeys(value, ['present', 'bytes', 'sha256'], name);
  if (source.present !== true || !Number.isSafeInteger(source.bytes) || source.bytes < 2 ||
      source.bytes > MAX_GLOBAL_SETTINGS_BYTES || typeof source.sha256 !== 'string' ||
      !DIGEST.test(source.sha256)) {
    throw new TypeError(`${name} is invalid`);
  }
  return Object.freeze({ present: true, bytes: source.bytes, sha256: source.sha256 });
}

function receiptTransition(value, name) {
  const source = exactKeys(value, ['before', 'after'], name);
  const before = receipt(source.before, `${name} before receipt`);
  const after = receipt(source.after, `${name} after receipt`);
  if (before.bytes === after.bytes && before.sha256 === after.sha256) {
    throw new TypeError(`${name} must change its target`);
  }
  return Object.freeze({ before, after });
}

function activation(value) {
  const source = exactKeys(value, [
    'globalSettings', 'destinationWorkspace',
  ], 'active context activation');
  return Object.freeze({
    globalSettings: receiptTransition(
      source.globalSettings,
      'active context GlobalSettings activation',
    ),
    destinationWorkspace: receiptTransition(
      source.destinationWorkspace,
      'active context destination Workspace activation',
    ),
  });
}

function expectedOutcomes(state, engineGeneration) {
  const complete = state !== 'prepared';
  return Object.freeze({
    browserWorkspace: complete ? 'closed' : 'pending',
    continuations: complete ? 'cancelled' : 'pending',
    engine: complete
      ? (engineGeneration === null ? 'not_required' : 'confirmed')
      : (engineGeneration === null ? 'not_required' : 'pending'),
    proxyAccess: complete ? 'revoked' : 'pending',
    serverState: complete ? 'cleared' : 'pending',
    destination: complete ? 'validated' : 'pending',
  });
}

function outcomes(value, state, engineGeneration) {
  const source = exactKeys(value, [
    'browserWorkspace', 'continuations', 'engine', 'proxyAccess', 'serverState',
    'destination',
  ], 'active context switch outcomes');
  const expected = expectedOutcomes(state, engineGeneration);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (source[key] !== expectedValue) {
      throw new TypeError(`active context switch outcome is invalid: ${key}`);
    }
  }
  return expected;
}

function validateActiveContextSwitchJournal(value) {
  const source = exactKeys(value, [
    'schemaVersion', 'type', 'state', 'switchId', 'kind', 'from', 'to',
    'nextActiveContextEpoch', 'engineGeneration', 'activation', 'outcomes',
    'createdAt', 'readyAt', 'committedAt',
  ], 'active context switch journal');
  if (source.schemaVersion !== ACTIVE_CONTEXT_SWITCH_JOURNAL_VERSION ||
      source.type !== ACTIVE_CONTEXT_SWITCH_TYPE || !JOURNAL_STATES.includes(source.state)) {
    throw new TypeError('active context switch journal version, type or state is unsupported');
  }
  const from = context(source.from, 'active context switch source');
  const to = context(source.to, 'active context switch destination');
  const kind = switchKind(from, to);
  if (source.kind !== kind) throw new TypeError('active context switch kind does not match');
  const nextActiveContextEpoch = positive(
    source.nextActiveContextEpoch,
    'nextActiveContextEpoch',
  );
  if (nextActiveContextEpoch <= from.activeContextEpoch ||
      nextActiveContextEpoch <= to.activeContextEpoch) {
    throw new TypeError('nextActiveContextEpoch must advance every bound context');
  }
  const engineGeneration = nullablePositive(source.engineGeneration, 'engineGeneration');
  const createdAt = positive(source.createdAt, 'createdAt');
  const readyAt = timestamp(source.readyAt, 'readyAt');
  const committedAt = timestamp(source.committedAt, 'committedAt');
  if (source.state === 'prepared' && (readyAt !== null || committedAt !== null)) {
    throw new TypeError('prepared active context switch contains completion timestamps');
  }
  if (source.state === 'ready' && (readyAt === null || committedAt !== null)) {
    throw new TypeError('ready active context switch timestamps are invalid');
  }
  if (source.state === 'committed' && (readyAt === null || committedAt === null)) {
    throw new TypeError('committed active context switch timestamps are incomplete');
  }
  if ((readyAt !== null && readyAt < createdAt) ||
      (committedAt !== null && committedAt < readyAt)) {
    throw new TypeError('active context switch timestamps are inconsistent');
  }
  return deepFreeze({
    schemaVersion: ACTIVE_CONTEXT_SWITCH_JOURNAL_VERSION,
    type: ACTIVE_CONTEXT_SWITCH_TYPE,
    state: source.state,
    switchId: validateOpaqueKey(source.switchId, 'switchId'),
    kind,
    from,
    to,
    nextActiveContextEpoch,
    engineGeneration,
    activation: activation(source.activation),
    outcomes: outcomes(source.outcomes, source.state, engineGeneration),
    createdAt,
    readyAt,
    committedAt,
  });
}

function switchId(randomBytes) {
  let entropy = randomBytes(16);
  if (!Buffer.isBuffer(entropy) || entropy.length !== 16) {
    entropy?.fill?.(0);
    throw new TypeError('active context switch entropy is invalid');
  }
  try { return `switch-${entropy.toString('hex')}`; }
  finally { entropy.fill(0); entropy = null; }
}

function createPreparedActiveContextSwitch({
  from: sourceContext,
  to: destinationContext,
  nextActiveContextEpoch = null,
  engineGeneration = null,
  activation: activationReceipts,
  randomBytes = crypto.randomBytes,
  now = Date.now,
} = {}) {
  if (typeof randomBytes !== 'function' || typeof now !== 'function') {
    throw new TypeError('active context switch dependencies are invalid');
  }
  const from = context(sourceContext, 'active context switch source');
  const to = context(destinationContext, 'active context switch destination');
  const epoch = nextActiveContextEpoch === null
    ? Math.max(from.activeContextEpoch, to.activeContextEpoch) + 1
    : nextActiveContextEpoch;
  return validateActiveContextSwitchJournal({
    schemaVersion: ACTIVE_CONTEXT_SWITCH_JOURNAL_VERSION,
    type: ACTIVE_CONTEXT_SWITCH_TYPE,
    state: 'prepared',
    switchId: switchId(randomBytes),
    kind: switchKind(from, to),
    from,
    to,
    nextActiveContextEpoch: epoch,
    engineGeneration,
    activation: activationReceipts,
    outcomes: expectedOutcomes('prepared', engineGeneration),
    createdAt: now(),
    readyAt: null,
    committedAt: null,
  });
}

function markActiveContextSwitchReady(document, { now = Date.now } = {}) {
  const prepared = validateActiveContextSwitchJournal(document);
  if (prepared.state !== 'prepared') {
    throw new TypeError('only a prepared active context switch can become ready');
  }
  if (typeof now !== 'function') throw new TypeError('active context switch clock is invalid');
  return validateActiveContextSwitchJournal({
    ...prepared,
    state: 'ready',
    outcomes: expectedOutcomes('ready', prepared.engineGeneration),
    readyAt: now(),
  });
}

function commitActiveContextSwitch(document, { now = Date.now } = {}) {
  const ready = validateActiveContextSwitchJournal(document);
  if (ready.state !== 'ready') {
    throw new TypeError('only a ready active context switch can commit');
  }
  if (typeof now !== 'function') throw new TypeError('active context switch clock is invalid');
  return validateActiveContextSwitchJournal({
    ...ready,
    state: 'committed',
    committedAt: now(),
  });
}

module.exports = {
  ACTIVE_CONTEXT_SWITCH_JOURNAL_VERSION,
  ACTIVE_CONTEXT_SWITCH_TYPE,
  commitActiveContextSwitch,
  createPreparedActiveContextSwitch,
  markActiveContextSwitchReady,
  validateActiveContextSwitchJournal,
};
