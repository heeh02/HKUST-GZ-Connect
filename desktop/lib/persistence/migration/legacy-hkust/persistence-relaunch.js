'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PERSISTENCE_RELAUNCH_ARGUMENT = '--profile-workspace-relaunch';

function persistenceRelaunchArguments({ argv, isPackaged, developmentEntry } = {}) {
  if (!Array.isArray(argv) || typeof isPackaged !== 'boolean' ||
      typeof developmentEntry !== 'string' || developmentEntry.length === 0) {
    throw new TypeError('persistence relaunch arguments are invalid');
  }
  if (argv.includes(PERSISTENCE_RELAUNCH_ARGUMENT)) {
    const error = new Error('Profile Workspace migration relaunch did not converge');
    error.code = 'PERSISTENCE_RELAUNCH_LOOP_BLOCKED';
    throw error;
  }
  const base = isPackaged ? argv.slice(1) : [developmentEntry];
  return Object.freeze([...base, PERSISTENCE_RELAUNCH_ARGUMENT]);
}

function relaunchAfterPersistenceMigration({ application, argv, isPackaged, developmentEntry } = {}) {
  if (!application || typeof application.relaunch !== 'function' ||
      typeof application.exit !== 'function') {
    throw new TypeError('persistence relaunch application is invalid');
  }
  const args = persistenceRelaunchArguments({ argv, isPackaged, developmentEntry });
  application.relaunch({ args });
  application.exit(0);
}

function writePersistenceE2EMarker({ application, environment, userData, mode } = {}) {
  if (!application || application.isPackaged || environment?.HKUSTGZ_PERSISTENCE_E2E !== '1') {
    return false;
  }
  fs.writeFileSync(path.join(userData, 'persistence-e2e-ready.json'),
    JSON.stringify({ mode, pid: process.pid }), { mode: 0o600 });
  return true;
}

module.exports = {
  PERSISTENCE_RELAUNCH_ARGUMENT,
  persistenceRelaunchArguments,
  relaunchAfterPersistenceMigration,
  writePersistenceE2EMarker,
};
