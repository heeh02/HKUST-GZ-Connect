'use strict';

const {
  commitActiveContextSwitch,
  createPreparedActiveContextSwitch,
  markActiveContextSwitchReady,
  validateActiveContextSwitchJournal,
} = require('./active-context-switch-journal');

class ActiveContextSwitchError extends Error {
  constructor(code, stage, cause = null) {
    super(`active context switch blocked at ${stage}`, cause ? { cause } : undefined);
    this.name = 'ActiveContextSwitchError';
    this.code = code;
    this.stage = stage;
  }
}

function sameReceipt(value, expected) {
  return Boolean(value && typeof value === 'object' && value.present === true &&
    value.bytes === expected.bytes && value.sha256 === expected.sha256);
}

const ACTIVATION_TARGETS = Object.freeze(['globalSettings', 'destinationWorkspace']);

function activationStatus(value, activation) {
  if (!value || typeof value !== 'object') return 'unknown';
  const states = ACTIVATION_TARGETS.map((target) => {
    if (sameReceipt(value[target], activation[target].before)) return 'before';
    if (sameReceipt(value[target], activation[target].after)) return 'after';
    return 'unknown';
  });
  if (states.includes('unknown')) return 'unknown';
  if (states.every((state) => state === 'before')) return 'before';
  if (states.every((state) => state === 'after')) return 'after';
  return 'mixed';
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

class ActiveContextSwitchCoordinator {
  constructor({
    journalStore,
    readActivationReceipt,
    applyActivation,
    gateBrowser,
    validateSource,
    cancelContinuations,
    closeBrowserWorkspace,
    stopEngine,
    revokeProxyAccess,
    clearServerState,
    validateDestination,
    activateRuntime,
    createPrepared = createPreparedActiveContextSwitch,
    markReady = markActiveContextSwitchReady,
    commit = commitActiveContextSwitch,
  } = {}) {
    if (!journalStore || typeof journalStore.read !== 'function' ||
        typeof journalStore.prepare !== 'function' ||
        typeof journalStore.markReady !== 'function' ||
        typeof journalStore.commit !== 'function' ||
        typeof journalStore.clearCommitted !== 'function') {
      throw new TypeError('active context switch journal store is invalid');
    }
    this.journalStore = journalStore;
    this.readActivationReceipt = requiredFunction(
      readActivationReceipt,
      'readActivationReceipt',
    );
    this.applyActivation = requiredFunction(applyActivation, 'applyActivation');
    this.gateBrowser = requiredFunction(gateBrowser, 'gateBrowser');
    this.validateSource = requiredFunction(validateSource, 'validateSource');
    this.cancelContinuations = requiredFunction(cancelContinuations, 'cancelContinuations');
    this.closeBrowserWorkspace = requiredFunction(
      closeBrowserWorkspace,
      'closeBrowserWorkspace',
    );
    this.stopEngine = requiredFunction(stopEngine, 'stopEngine');
    this.revokeProxyAccess = requiredFunction(revokeProxyAccess, 'revokeProxyAccess');
    this.clearServerState = requiredFunction(clearServerState, 'clearServerState');
    this.validateDestination = requiredFunction(validateDestination, 'validateDestination');
    this.activateRuntime = requiredFunction(activateRuntime, 'activateRuntime');
    this.createPrepared = requiredFunction(createPrepared, 'createPrepared');
    this.markReady = requiredFunction(markReady, 'markReady');
    this.commit = requiredFunction(commit, 'commit');
    this.running = false;
  }

  begin(request) {
    return this.#singleFlight(async () => {
      if (this.journalStore.read() !== null) {
        throw new ActiveContextSwitchError(
          'ACTIVE_CONTEXT_SWITCH_ALREADY_PENDING',
          'prepare',
        );
      }
      const prepared = validateActiveContextSwitchJournal(this.createPrepared(request));
      let result;
      try { result = this.journalStore.prepare(prepared); }
      catch (error) {
        throw new ActiveContextSwitchError(
          'ACTIVE_CONTEXT_SWITCH_PREPARE_FAILED',
          'prepare',
          error,
        );
      }
      if (!result || result.prepared !== true) {
        throw new ActiveContextSwitchError(
          'ACTIVE_CONTEXT_SWITCH_PREPARE_UNCONFIRMED',
          'prepare',
        );
      }
      const observed = this.journalStore.read();
      if (!sameDocument(observed, prepared)) {
        throw new ActiveContextSwitchError(
          'ACTIVE_CONTEXT_SWITCH_PREPARE_UNCONFIRMED',
          'prepare',
        );
      }
      return this.#resumePrepared(prepared);
    });
  }

  recover() {
    return this.#singleFlight(async () => {
      let journal;
      try { journal = this.journalStore.read(); }
      catch (error) {
        throw new ActiveContextSwitchError(
          'ACTIVE_CONTEXT_SWITCH_JOURNAL_UNREADABLE',
          'recover',
          error,
        );
      }
      if (journal === null) return Object.freeze({ ok: true, status: 'none' });
      if (journal.state === 'prepared') return this.#resumePrepared(journal);
      if (journal.state === 'ready') return this.#activateReady(journal);
      if (journal.state === 'committed') return this.#finishCommitted(journal);
      throw new ActiveContextSwitchError(
        'ACTIVE_CONTEXT_SWITCH_JOURNAL_UNSUPPORTED',
        'recover',
      );
    });
  }

  async #resumePrepared(journal) {
    await this.#requireStep('browser-gate', this.gateBrowser, journal);
    this.#requireActivationState(journal, 'before', 'source-authority');
    await this.#requireStep('source-validation', this.validateSource, journal);
    await this.#requireStep('continuation-cancel', this.cancelContinuations, journal);
    await this.#requireStep('browser-close', this.closeBrowserWorkspace, journal);
    await this.#requireStep('engine-stop', this.stopEngine, journal);
    await this.#requireStep('proxy-revoke', this.revokeProxyAccess, journal);
    await this.#requireStep('server-state-clear', this.clearServerState, journal);
    await this.#requireStep('destination-validation', this.validateDestination, journal);

    const ready = validateActiveContextSwitchJournal(this.markReady(journal));
    let result;
    try { result = this.journalStore.markReady(ready); }
    catch (error) {
      throw new ActiveContextSwitchError(
        'ACTIVE_CONTEXT_SWITCH_READY_FAILED',
        'ready',
        error,
      );
    }
    if (!result || result.ready !== true || !sameDocument(this.journalStore.read(), ready)) {
      throw new ActiveContextSwitchError(
        'ACTIVE_CONTEXT_SWITCH_READY_UNCONFIRMED',
        'ready',
      );
    }
    return this.#activateReady(ready);
  }

  async #activateReady(journal) {
    const observed = this.#activationState(journal);
    const status = activationStatus(observed, journal.activation);
    if (status === 'before' || status === 'mixed') {
      try {
        if (await this.applyActivation(journal) !== true) {
          throw new Error('activation callback did not confirm its commit');
        }
      } catch (error) {
        throw new ActiveContextSwitchError(
          'ACTIVE_CONTEXT_SWITCH_ACTIVATION_FAILED',
          'activation',
          error,
        );
      }
      this.#requireActivationState(journal, 'after', 'activation');
    } else if (status !== 'after') {
      throw new ActiveContextSwitchError(
        'ACTIVE_CONTEXT_SWITCH_ACTIVATION_AMBIGUOUS',
        'activation',
      );
    }

    const committed = validateActiveContextSwitchJournal(this.commit(journal));
    let result;
    try { result = this.journalStore.commit(committed); }
    catch (error) {
      throw new ActiveContextSwitchError(
        'ACTIVE_CONTEXT_SWITCH_COMMIT_FAILED',
        'commit',
        error,
      );
    }
    if (!result || result.committed !== true ||
        !sameDocument(this.journalStore.read(), committed)) {
      throw new ActiveContextSwitchError(
        'ACTIVE_CONTEXT_SWITCH_COMMIT_UNCONFIRMED',
        'commit',
      );
    }
    return this.#finishCommitted(committed);
  }

  async #finishCommitted(journal) {
    this.#requireActivationState(journal, 'after', 'committed-authority');
    try {
      if (this.journalStore.clearCommitted() !== true) {
        throw new Error('committed journal was not cleared');
      }
    } catch (error) {
      throw new ActiveContextSwitchError(
        'ACTIVE_CONTEXT_SWITCH_CLEAR_FAILED',
        'clear',
        error,
      );
    }
    await this.#requireStep('runtime-activation', this.activateRuntime, journal);
    return Object.freeze({
      ok: true,
      status: 'activated',
      switchId: journal.switchId,
      kind: journal.kind,
      activeContextEpoch: journal.nextActiveContextEpoch,
    });
  }

  #activationState(journal) {
    try { return this.readActivationReceipt(journal); }
    catch (error) {
      throw new ActiveContextSwitchError(
        'ACTIVE_CONTEXT_SWITCH_AUTHORITY_UNREADABLE',
        'authority-read',
        error,
      );
    }
  }

  #requireActivationState(journal, expected, stage) {
    if (activationStatus(this.#activationState(journal), journal.activation) !== expected) {
      throw new ActiveContextSwitchError(
        'ACTIVE_CONTEXT_SWITCH_AUTHORITY_MISMATCH',
        stage,
      );
    }
  }

  async #requireStep(stage, operation, journal) {
    try {
      if (await operation(journal) !== true) {
        throw new Error(`${stage} did not confirm completion`);
      }
    } catch (error) {
      throw new ActiveContextSwitchError(
        `ACTIVE_CONTEXT_SWITCH_${stage.replaceAll('-', '_').toUpperCase()}_FAILED`,
        stage,
        error,
      );
    }
  }

  #singleFlight(operation) {
    if (this.running) {
      return Promise.reject(new ActiveContextSwitchError(
        'ACTIVE_CONTEXT_SWITCH_ALREADY_RUNNING',
        'single-flight',
      ));
    }
    this.running = true;
    return Promise.resolve()
      .then(operation)
      .finally(() => { this.running = false; });
  }
}

module.exports = {
  ActiveContextSwitchCoordinator,
  ActiveContextSwitchError,
};
