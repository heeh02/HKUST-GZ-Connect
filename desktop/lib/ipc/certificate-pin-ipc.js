'use strict';

const { allowedKeys, boundedString } = require('./ipc-guard');

function safePins(store) {
  try { return store.list(); } catch { return []; }
}

function registerCertificatePinIpc({ register, store } = {}) {
  if (typeof register !== 'function' || !store || typeof store.list !== 'function' ||
      typeof store.delete !== 'function') {
    throw new TypeError('certificate pin IPC dependencies are incomplete');
  }
  register('list-certificate-pins', () => {
    try {
      return { ok: true, pins: store.list() };
    } catch (error) {
      return { ok: false, error: error.message, pins: [] };
    }
  });
  register('delete-certificate-pin', (_event, payload) => {
    try {
      const source = allowedKeys(payload, ['origin', 'fingerprint']);
      const pins = store.delete({
        origin: boundedString(source.origin, {
          minLength: 1, maxLength: 2048, trim: true,
        }),
        fingerprint: boundedString(source.fingerprint, {
          minLength: 64, maxLength: 64, trim: true,
        }),
      });
      return { ok: true, pins };
    } catch (error) {
      // A transient read error must not escape IPC or reconstruct an old grant.
      return { ok: false, error: error.message, pins: safePins(store) };
    }
  });
}

module.exports = {
  registerCertificatePinIpc,
};
