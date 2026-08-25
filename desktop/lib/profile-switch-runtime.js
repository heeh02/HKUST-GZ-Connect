'use strict';

const { ActiveContextSwitchSystem } = require('./active-context-switch-system');

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function sameContext(left, right) {
  return Boolean(left && right && [
    'profileId', 'profileKey', 'profileRevision', 'profileCredentialBindingRevision',
    'accountKey', 'accountRevision', 'accountCredentialRevision', 'workspaceKey',
    'activeContextEpoch',
  ].every((key) => left[key] === right[key]));
}

class ProfileSwitchRuntime {
  constructor({
    directory,
    journalStore,
    activationStore,
    barrier,
    getActivePersistentContext,
    getEngineGeneration,
    activateRuntime,
    SwitchSystemClass = ActiveContextSwitchSystem,
  } = {}) {
    if (!directory || typeof directory.withCandidate !== 'function' ||
        !activationStore || typeof activationStore.plan !== 'function' ||
        typeof SwitchSystemClass !== 'function') {
      throw new TypeError('Profile switch runtime dependencies are invalid');
    }
    this.directory = directory;
    this.activationStore = activationStore;
    this.getActivePersistentContext = requiredFunction(
      getActivePersistentContext,
      'getActivePersistentContext',
    );
    this.getEngineGeneration = requiredFunction(getEngineGeneration, 'getEngineGeneration');
    this.activateRuntime = requiredFunction(activateRuntime, 'activateRuntime');
    this.system = new SwitchSystemClass({
      journalStore,
      activationStore,
      barrier,
      validateSource: (journal) => this.#validateSource(journal),
      validateDestination: (journal) => this.#validateDestination(journal),
      activateRuntime: (journal) => this.#activate(journal),
    });
  }

  switchTo(profileId) {
    const from = this.getActivePersistentContext();
    const record = this.#candidate(profileId);
    const to = record.context;
    if (sameContext(from, to) || from.profileId === to.profileId) {
      throw new Error('requested Profile is already active');
    }
    const nextActiveContextEpoch = Math.max(
      from.activeContextEpoch,
      to.activeContextEpoch,
    ) + 1;
    if (!Number.isSafeInteger(nextActiveContextEpoch)) {
      throw new Error('next active context epoch is invalid');
    }
    const engineGeneration = this.getEngineGeneration();
    if (engineGeneration !== null &&
        (!Number.isSafeInteger(engineGeneration) || engineGeneration <= 0)) {
      throw new TypeError('active Engine generation is invalid');
    }
    const activation = this.activationStore.plan({
      from,
      to,
      nextActiveContextEpoch,
    });
    return this.system.begin({
      from,
      to,
      nextActiveContextEpoch,
      engineGeneration,
      activation,
    });
  }

  recover() { return this.system.recover(); }

  #validateSource(journal) {
    if (!sameContext(this.getActivePersistentContext(), journal.from)) return false;
    return this.directory.withCandidate(journal.from.profileId, (record) => (
      sameContext(record.context, journal.from)
    ));
  }

  #validateDestination(journal) {
    return this.directory.withCandidate(journal.to.profileId, (record) => (
      sameContext(record.context, journal.to)
    ));
  }

  #activate(journal) {
    return this.activateRuntime(this.#candidate(journal.to.profileId), journal);
  }

  #candidate(profileId) {
    let candidate = null;
    this.directory.withCandidate(profileId, (record) => { candidate = record; });
    if (!candidate) throw new Error('Profile candidate is unavailable');
    return candidate;
  }
}

module.exports = { ProfileSwitchRuntime, samePersistentContext: sameContext };
