'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SYNTHETIC_ENGINE_E2E_ENV = 'HKUSTGZ_SYNTHETIC_ENGINE_E2E';
const SYNTHETIC_ENGINE_FIXTURE = 'main-engine-fixture.js';

function exactExecutablePattern(executablePath) {
  if (typeof executablePath !== 'string' || !executablePath.length) return '';
  const escaped = executablePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escaped}( |$)`;
}

function resolveEngineLaunch({
  appIsPackaged,
  baseDirectory,
  nativeEngine,
  execPath,
  environment = process.env,
  fileSystem = fs,
} = {}) {
  if (![baseDirectory, nativeEngine, execPath].every((value) => (
    typeof value === 'string' && path.isAbsolute(value)
  )) || !environment || typeof environment !== 'object') {
    throw new TypeError('engine launch inputs are invalid');
  }
  const native = Object.freeze({
    command: nativeEngine,
    argsPrefix: Object.freeze([]),
    options: Object.freeze({}),
    synthetic: false,
  });
  if (appIsPackaged || environment[SYNTHETIC_ENGINE_E2E_ENV] !== '1') return native;

  const fixtureDirectory = fileSystem.realpathSync(path.join(baseDirectory, 'e2e'));
  const fixture = fileSystem.realpathSync(path.join(
    baseDirectory,
    'e2e',
    SYNTHETIC_ENGINE_FIXTURE,
  ));
  if (path.dirname(fixture) !== fixtureDirectory ||
      path.basename(fixture) !== SYNTHETIC_ENGINE_FIXTURE) {
    throw new Error('synthetic engine fixture escaped its test directory');
  }
  return Object.freeze({
    command: execPath,
    argsPrefix: Object.freeze([fixture]),
    options: Object.freeze({
      env: Object.freeze({ ...environment, ELECTRON_RUN_AS_NODE: '1' }),
    }),
    synthetic: true,
  });
}

module.exports = {
  SYNTHETIC_ENGINE_E2E_ENV,
  SYNTHETIC_ENGINE_FIXTURE,
  exactExecutablePattern,
  resolveEngineLaunch,
};
