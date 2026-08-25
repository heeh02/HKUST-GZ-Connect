'use strict';

const {
  ActiveContextSwitchCoordinator,
} = require('./active-context-switch-coordinator');

function required(value, name, methods = []) {
  if (!value || typeof value !== 'object' ||
      methods.some((method) => typeof value[method] !== 'function')) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

class ActiveContextSwitchSystem {
  constructor({
    journalStore,
    activationStore,
    barrier,
    validateSource,
    validateDestination,
    activateRuntime,
    CoordinatorClass = ActiveContextSwitchCoordinator,
  } = {}) {
    required(journalStore, 'active context journal store', [
      'read', 'prepare', 'markReady', 'commit', 'clearCommitted',
    ]);
    required(activationStore, 'active context activation store', ['readState', 'apply']);
    required(barrier, 'active context cleanup barrier', ['hooks']);
    requiredFunction(validateSource, 'validateSource');
    requiredFunction(validateDestination, 'validateDestination');
    requiredFunction(activateRuntime, 'activateRuntime');
    if (typeof CoordinatorClass !== 'function') {
      throw new TypeError('active context coordinator class is invalid');
    }
    const hooks = barrier.hooks();
    this.coordinator = new CoordinatorClass({
      journalStore,
      readActivationReceipt: (journal) => activationStore.readState(journal),
      applyActivation: (journal) => activationStore.apply(journal),
      validateSource,
      validateDestination,
      activateRuntime,
      ...hooks,
    });
    Object.freeze(this);
  }

  begin(request) { return this.coordinator.begin(request); }

  recover() { return this.coordinator.recover(); }
}

module.exports = { ActiveContextSwitchSystem };
