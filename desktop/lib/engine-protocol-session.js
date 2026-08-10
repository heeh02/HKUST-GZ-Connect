'use strict';

const { EVENT_TYPES } = require('./engine-protocol');

const ENGINE_HELLO_TIMEOUT_MS = 1500;

function validGeneration(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Owns the machine-protocol ordering for one child process. Process ownership
// remains with EngineSupervisor; this small state object ensures an event from
// an old/malformed stream cannot update the current connection or its final
// stop reason.
class EngineProtocolSession {
  constructor(generation) {
    if (!validGeneration(generation)) throw new TypeError('valid engine generation is required');
    this.generation = generation;
    this.helloSeen = false;
    this.stoppedReason = null;
  }

  accept(event) {
    if (!event || typeof event !== 'object' || !EVENT_TYPES.has(event.type) ||
        this.stoppedReason) return false;
    if (!this.helloSeen) {
      if (event.type !== 'hello') return false;
      this.helloSeen = true;
      return true;
    }
    if (event.type === 'hello') return false;
    if ((event.type === 'state_changed' || event.type === 'stopped') &&
        event.generation !== this.generation) return false;
    if (event.type === 'stopped') this.stoppedReason = event.reason;
    return true;
  }
}

module.exports = { ENGINE_HELLO_TIMEOUT_MS, EngineProtocolSession };
