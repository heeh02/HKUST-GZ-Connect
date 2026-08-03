'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const asar = require('@electron/asar');
const { classifyMacSignature } = require('./macos-signing');

function resolveResourcesDirectory(input) {
  const resolved = path.resolve(input);
  return resolved.endsWith('.app') ? path.join(resolved, 'Contents', 'Resources') : resolved;
}

function resolveMacAppPath(input) {
  const resolved = path.resolve(input);
  if (resolved.endsWith('.app')) return resolved;
  if (path.basename(resolved) === 'Resources'
    && path.basename(path.dirname(resolved)) === 'Contents'
    && path.dirname(path.dirname(resolved)).endsWith('.app')) {
    return path.dirname(path.dirname(resolved));
  }
  return null;
}

function readMacSignature(appPath) {
  const result = spawnSync('codesign', ['-dvvv', appPath], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`codesign diagnostics failed for ${appPath}: ${String(result.stderr || '').trim()}`);
  }
  return classifyMacSignature(`${result.stdout || ''}\n${result.stderr || ''}`);
}

function parseArguments(argv) {
  const positional = [];
  let requireAppleSignature = false;
  for (const argument of argv) {
    if (argument === '--require-apple-signature') requireAppleSignature = true;
    else positional.push(argument);
  }
  return {
    resourcesArgument: positional[0],
    platform: positional[1] || process.platform,
    architecture: positional[2] || process.arch,
    requireAppleSignature,
  };
}

function verifyPackage({ resourcesArgument, platform = process.platform, architecture = process.arch, requireAppleSignature = false }) {
  if (!resourcesArgument) {
    throw new Error('usage: node build/verify-package.js <app-or-resources-dir> [platform] [arch] [--require-apple-signature]');
  }

  const resources = resolveResourcesDirectory(resourcesArgument);
const archive = path.join(resources, 'app.asar');
if (!fs.existsSync(archive)) throw new Error(`missing packaged application: ${archive}`);

const entries = new Set(
  asar.listPackage(archive).map((entry) => entry.replaceAll('\\', '/')),
);
const requiredEntries = [
  '/main.js',
  '/campus-preload.js',
  '/lib/campus-browser.js',
  '/lib/campus-credential-vault.js',
  '/lib/app-data-dir.js',
  '/lib/login-flow.js',
  '/lib/settings-update.js',
  '/lib/tunnel-health.js',
  '/renderer/app.js',
  '/renderer/campus-browser.html',
  '/renderer/campus-browser.js',
  '/renderer/campus-browser.css',
  '/assets/campus-resources.json',
];
for (const entry of requiredEntries) {
  if (!entries.has(entry)) throw new Error(`missing required packaged file: ${entry}`);
}

const packagedIndex = asar.extractFile(archive, 'renderer/index.html').toString('utf8');
const packagedRenderer = asar.extractFile(archive, 'renderer/app.js').toString('utf8');
if (/\.\.\/lib\/(?:login-flow|resource-view)\.js/.test(packagedIndex)) {
  throw new Error('renderer must not depend on split helper scripts');
}
for (const helper of ['evaluateLoginProgress', 'visibleResources', 'routeLabel']) {
  if (!packagedRenderer.includes(`function ${helper}`)) {
    throw new Error(`renderer helper is not self-contained: ${helper}`);
  }
}

const platformName = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';
const architectureName = architecture === 'arm64' ? 'arm64' : 'amd64';
const extension = platformName === 'windows' ? '.exe' : '';
const engineName = `ec-engine-${platformName}-${architectureName}${extension}`;
const engine = path.join(resources, 'engine', engineName);
if (!fs.existsSync(engine) || fs.statSync(engine).size === 0) {
  throw new Error(`missing packaged engine: ${engine}`);
}

if (platformName === 'windows') {
  const header = fs.readFileSync(engine);
  const peOffset = header.length >= 0x40 ? header.readUInt32LE(0x3c) : -1;
  const signature = peOffset >= 0 && peOffset + 6 <= header.length
    ? header.subarray(peOffset, peOffset + 4).toString('binary')
    : '';
  const machine = signature === 'PE\u0000\u0000' ? header.readUInt16LE(peOffset + 4) : -1;
  const expectedMachine = architectureName === 'arm64' ? 0xaa64 : 0x8664;
  if (machine !== expectedMachine) {
    throw new Error(
      `packaged engine is not a ${architectureName} Windows PE executable: ${engine}`,
    );
  }
}

const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
const sourceManifest = require(path.join(__dirname, '..', 'package.json'));
if (packagedManifest.version !== sourceManifest.version) {
  throw new Error(
    `packaged version ${packagedManifest.version} does not match source ${sourceManifest.version}`,
  );
}

  let signature = 'not-applicable';
  const appPath = platformName === 'darwin' ? resolveMacAppPath(resourcesArgument) : null;
  if (appPath) signature = readMacSignature(appPath);
  if (requireAppleSignature && signature !== 'apple') {
    throw new Error(`package requires an Apple signature, found signature=${signature}`);
  }

  return `verified ${platformName}/${architectureName}: campus browser, settings update, engine, signature=${signature}, v${packagedManifest.version}`;
}

module.exports = {
  parseArguments,
  readMacSignature,
  resolveMacAppPath,
  resolveResourcesDirectory,
  verifyPackage,
};

if (require.main === module) {
  process.stdout.write(`${verifyPackage(parseArguments(process.argv.slice(2)))}\n`);
}
