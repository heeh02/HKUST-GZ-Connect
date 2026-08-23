'use strict';

const { EngineAuthControlClient } = require('./engine-auth-control-client');
const { EngineControlClient } = require('./engine-control-client');
const { AuthChallengeCoordinator } = require('./auth-challenge-coordinator');

class EngineControlSuite {
  constructor({ writable, generation } = {}) {
    this.v2 = new EngineControlClient({ writable });
    this.auth = new EngineAuthControlClient({ writable, generation });
  }

  get negotiated() { return this.v2.negotiated; }

  handshake() { return this.v2.handshake(); }

  shutdown() { return this.v2.shutdown(); }

  feed(value) {
    this.v2.feed(value);
    this.auth.feed(value);
  }

  setAuthHandlers(handlers) { this.auth.setHandlers(handlers); }

  respond(secret) { return this.auth.respond(secret); }

  resend() { return this.auth.resend(); }

  cancel() { return this.auth.cancel(); }

  close(error) {
    this.v2.close(error);
    this.auth.close(error);
  }
}

class EngineControlRegistry {
  constructor({ authChallenges } = {}) {
    if (!authChallenges || typeof authChallenges.bind !== 'function') {
      throw new TypeError('an auth challenge coordinator is required');
    }
    this.authChallenges = authChallenges;
    this.active = null;
  }

  bind(generation, writable) {
    this.clear();
    const client = new EngineControlSuite({ writable, generation });
    this.active = { generation, client };
    this.authChallenges.bind(generation, client);
    return client;
  }

  clear(expectedGeneration = null) {
    if (!this.active || (expectedGeneration !== null &&
        this.active.generation !== expectedGeneration)) return false;
    const { generation, client } = this.active;
    this.active = null;
    this.authChallenges.detach(generation);
    client.close();
    return true;
  }

  shutdown() {
    if (!this.active?.client.negotiated) return false;
    return this.active.client.shutdown().then(() => true);
  }
}

module.exports = {
  AuthChallengeCoordinator,
  EngineControlRegistry,
  EngineControlSuite,
};
