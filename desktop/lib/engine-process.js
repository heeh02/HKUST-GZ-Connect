'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SYNTHETIC_ENGINE_E2E_ENV = 'HKUSTGZ_SYNTHETIC_ENGINE_E2E';
const SYNTHETIC_ENGINE_FIXTURE = 'main-engine-fixture.js';
const SYNTHETIC_GATEWAY_PROBE_E2E_ENV = 'HKUSTGZ_SYNTHETIC_GATEWAY_PROBE_E2E';
const SYNTHETIC_GATEWAY_PROBE_FIXTURE = 'main-gateway-probe-fixture.js';
const NATIVE_RESOURCE_KINDS = new Set([
  'ec-engine',
  'ec-gateway-probe',
  'ec-proxy-command',
]);

function exactExecutablePattern(executablePath) {
  if (typeof executablePath !== 'string' || !executablePath.length) return '';
  const escaped = executablePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escaped}( |$)`;
}

function resolveNativeResourcePath({
  kind,
  appIsPackaged,
  baseDirectory,
  resourcesPath,
  platform = process.platform,
  architecture = process.arch,
  fileSystem = fs,
} = {}) {
  if (!NATIVE_RESOURCE_KINDS.has(kind) || typeof appIsPackaged !== 'boolean' ||
      typeof baseDirectory !== 'string' || !path.isAbsolute(baseDirectory) ||
      typeof resourcesPath !== 'string' || !path.isAbsolute(resourcesPath) ||
      !['darwin', 'linux', 'win32'].includes(platform) ||
      !['arm64', 'x64'].includes(architecture) ||
      !fileSystem || typeof fileSystem.existsSync !== 'function') {
    throw new TypeError('native resource path inputs are invalid');
  }
  const platformName = platform === 'win32' ? 'windows' : platform;
  const archName = architecture === 'arm64' ? 'arm64' : 'amd64';
  const extension = platform === 'win32' ? '.exe' : '';
  const named = `${kind}-${platformName}-${archName}${extension}`;
  const generic = `${kind}${extension}`;
  const directory = appIsPackaged
    ? path.join(resourcesPath, 'engine')
    : path.join(baseDirectory, 'engine');
  const candidates = [
    path.join(directory, named),
    path.join(directory, generic),
    path.join(baseDirectory, '..', 'independent', 'target', 'release', generic),
  ];
  return candidates.find((candidate) => fileSystem.existsSync(candidate)) || candidates[0];
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

function resolveGatewayProbeLaunch({
  appIsPackaged,
  baseDirectory,
  nativeProbe,
  execPath,
  environment = process.env,
  fileSystem = fs,
} = {}) {
  if (![baseDirectory, nativeProbe, execPath].every((value) => (
    typeof value === 'string' && path.isAbsolute(value)
  )) || !environment || typeof environment !== 'object') {
    throw new TypeError('Gateway probe launch inputs are invalid');
  }
  const native = Object.freeze({
    command: nativeProbe,
    argsPrefix: Object.freeze([]),
    electronRunAsNode: false,
    synthetic: false,
  });
  if (appIsPackaged || environment[SYNTHETIC_GATEWAY_PROBE_E2E_ENV] !== '1') {
    return native;
  }

  const fixtureDirectory = fileSystem.realpathSync(path.join(baseDirectory, 'e2e'));
  const fixture = fileSystem.realpathSync(path.join(
    baseDirectory,
    'e2e',
    SYNTHETIC_GATEWAY_PROBE_FIXTURE,
  ));
  if (path.dirname(fixture) !== fixtureDirectory ||
      path.basename(fixture) !== SYNTHETIC_GATEWAY_PROBE_FIXTURE) {
    throw new Error('synthetic Gateway probe fixture escaped its test directory');
  }
  return Object.freeze({
    command: execPath,
    argsPrefix: Object.freeze([fixture]),
    electronRunAsNode: true,
    synthetic: true,
  });
}

module.exports = {
  SYNTHETIC_ENGINE_E2E_ENV,
  SYNTHETIC_ENGINE_FIXTURE,
  SYNTHETIC_GATEWAY_PROBE_E2E_ENV,
  SYNTHETIC_GATEWAY_PROBE_FIXTURE,
  exactExecutablePattern,
  resolveGatewayProbeLaunch,
  resolveNativeResourcePath,
  resolveEngineLaunch,
};
