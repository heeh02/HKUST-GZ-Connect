'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const asar = require('@electron/asar');
const { classifyMacSignature } = require('./macos-signing');

const FORBIDDEN_TEST_RESOURCE = /(?:^|\/)(?:e2e|tests?|fixtures?|synthetic|fake[-_]?gateway|test[-_]?ca|pki)(?:\/|[-_.])|(?:^|\/)private[-_]?key(?:$|[-_.\/])|\.(?:pem|key|p12|pfx)$/iu;
const TEST_ONLY_ENGINE_MARKER = 'HKUSTGZ_TEST_ONLY_ENGINE_LIFECYCLE_V1';
const TEST_ONLY_ENGINE_MARKER_BYTES = Buffer.from(TEST_ONLY_ENGINE_MARKER, 'ascii');
const MARKER_SCAN_CHUNK_BYTES = 64 * 1024;

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

function assertLinuxElfArchitecture(executable, architectureName) {
  const descriptor = fs.openSync(executable, 'r');
  const header = Buffer.alloc(20);
  let bytesRead;
  try {
    bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const isElf = header.length >= 20
    && bytesRead === header.length
    && header[0] === 0x7f
    && header.subarray(1, 4).toString('ascii') === 'ELF'
    && header[4] === 2;
  const byteOrder = isElf ? header[5] : 0;
  const machine = byteOrder === 1
    ? header.readUInt16LE(18)
    : byteOrder === 2
      ? header.readUInt16BE(18)
      : -1;
  const expectedMachine = architectureName === 'arm64' ? 0xb7 : 0x3e;
  if (!isElf || machine !== expectedMachine) {
    throw new Error(
      `packaged binary is not a ${architectureName} Linux ELF executable: ${executable}`,
    );
  }
}

function assertNoTestOnlyEngineMarker(executable) {
  const descriptor = fs.openSync(executable, 'r');
  let overlap = Buffer.alloc(0);
  try {
    while (true) {
      const chunk = Buffer.alloc(MARKER_SCAN_CHUNK_BYTES);
      const bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      const searchable = overlap.length
        ? Buffer.concat([overlap, chunk.subarray(0, bytesRead)])
        : chunk.subarray(0, bytesRead);
      if (searchable.indexOf(TEST_ONLY_ENGINE_MARKER_BYTES) !== -1) {
        throw new Error(`test-only lifecycle Engine entered the package: ${executable}`);
      }
      const overlapBytes = Math.min(TEST_ONLY_ENGINE_MARKER_BYTES.length - 1, searchable.length);
      overlap = Buffer.from(searchable.subarray(searchable.length - overlapBytes));
    }
  } finally {
    fs.closeSync(descriptor);
  }
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

function assertCustomResourceManager({
  html,
  renderer,
  preload,
  main,
  controlDataIpc = '',
  resourceIpc = '',
  resourceRenderer = '',
}) {
  const missing = [];
  if (!String(html).includes('id="manageResources"')) missing.push('manage button');
  if (!String(html).includes('id="resourceDialog"')) missing.push('resource dialog');
  if (!String(html).includes('id="saveResource"')) missing.push('save website button');
  if (!String(html).includes('id="quickAddCampus"')) missing.push('add and open button');
  if (!String(html).includes('id="resourceSaved"')) missing.push('save confirmation');
  if (!String(renderer).includes('window.api.saveResource')) missing.push('renderer save action');
  const composedResourceRenderer = String(renderer).includes('resourceManager.start(')
    && String(resourceRenderer).includes('function suggestedResourceName');
  if (!String(renderer).includes('function suggestedResourceName') && !composedResourceRenderer) {
    missing.push('URL naming helper');
  }
  if (!String(preload).includes("saveResource: (resource) => ipcRenderer.invoke('save-resource', resource)")) {
    missing.push('preload bridge');
  }
  const mainSource = String(main);
  const directHandler = mainSource.includes("ipcMain.handle('save-resource'")
    || mainSource.includes("trustedHandle('save-resource'");
  const composedHandler = mainSource.includes('registerControlDataIpc(')
    && String(controlDataIpc).includes('registerCampusResourceIpc(')
    && String(resourceIpc).includes("register('save-resource'");
  if (!directHandler && !composedHandler) {
    missing.push('save handler');
  }
  if (!String(main).includes("app.on('certificate-error'")) missing.push('certificate handler');
  if (missing.length) {
    throw new Error(`custom resource manager is incomplete: ${missing.join(', ')}`);
  }
}

function assertNoTestOnlyPackageEntries(entries) {
  for (const rawEntry of entries) {
    const entry = String(rawEntry).replaceAll('\\', '/');
    if (FORBIDDEN_TEST_RESOURCE.test(entry)) {
      throw new Error(`test-only or private-key resource entered the package: ${entry}`);
    }
  }
}

function assertNoTestOnlyNativeResources(engineDirectory) {
  let directoryStat;
  try { directoryStat = fs.lstatSync(engineDirectory); } catch {}
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`missing packaged engine directory: ${engineDirectory}`);
  }
  const entries = fs.readdirSync(engineDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const normalized = `/${entry.name}`;
    if (!entry.isFile() || entry.isSymbolicLink() || FORBIDDEN_TEST_RESOURCE.test(normalized)) {
      throw new Error(`test-only or unsafe native resource entered the package: ${entry.name}`);
    }
  }
}

function assertExactNativeResources(engineDirectory, expectedNames) {
  if (!Array.isArray(expectedNames) || expectedNames.length === 0 ||
      expectedNames.some((name) => (
        typeof name !== 'string' || !name || path.basename(name) !== name || /[\0\r\n]/u.test(name)
      ))) {
    throw new TypeError('expected native resource names are invalid');
  }
  let directoryStat;
  try { directoryStat = fs.lstatSync(engineDirectory); } catch {}
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`missing packaged engine directory: ${engineDirectory}`);
  }

  const expected = [...new Set(expectedNames)].sort();
  const actual = [];
  for (const entry of fs.readdirSync(engineDirectory, { withFileTypes: true })) {
    const normalized = `/${entry.name}`;
    if (!entry.isFile() || entry.isSymbolicLink() || FORBIDDEN_TEST_RESOURCE.test(normalized)) {
      throw new Error(`test-only or unsafe native resource entered the package: ${entry.name}`);
    }
    const resource = path.join(engineDirectory, entry.name);
    if (fs.statSync(resource).size === 0) {
      throw new Error(`empty native resource entered the package: ${entry.name}`);
    }
    actual.push(entry.name);
  }
  actual.sort();

  const missing = expected.filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expected.includes(name));
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `missing=${missing.join(',')}` : '',
      unexpected.length ? `unexpected=${unexpected.join(',')}` : '',
    ].filter(Boolean).join(' ');
    throw new Error(`packaged native resource set is not exact: ${details}`);
  }
  return actual;
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
    '/preload.js',
    '/campus-preload.js',
    '/lib/campus-browser.js',
    '/lib/campus-certificate-trust.js',
    '/lib/campus-credential-vault.js',
    '/lib/app-data-dir.js',
    '/lib/i18n.js',
    '/lib/login-flow.js',
    '/lib/resource-view.js',
    '/lib/engine-control-client.js',
    '/lib/engine-auth-control-client.js',
    '/lib/engine-connection-runtime.js',
    '/lib/engine-control-suite.js',
    '/lib/desktop-shell.js',
    '/lib/windows-private-file.js',
    '/lib/campus-browser-manager.js',
    '/lib/connection-telemetry-coordinator.js',
    '/lib/engine-protocol-session.js',
    '/lib/auth-challenge-coordinator.js',
    '/lib/control-data-ipc.js',
    '/lib/control-ipc-suite.js',
    '/lib/core-control-ipc.js',
    '/lib/settings-credential-ipc.js',
    '/lib/routing-rule-ipc.js',
    '/lib/certificate-pin-ipc.js',
    '/lib/campus-resource-ipc.js',
    '/lib/settings-update.js',
    '/lib/tunnel-health.js',
    '/lib/update-check.js',
    '/renderer/app.js',
    '/renderer/auth-challenge.js',
    '/renderer/manager-view.js',
    '/renderer/routing-manager.js',
    '/renderer/certificate-manager.js',
    '/renderer/resource-manager.js',
    '/renderer/proxy-auth-migration.js',
    '/renderer/i18n.js',
    '/renderer/campus-browser.html',
    '/renderer/campus-browser.js',
    '/renderer/campus-browser.css',
    '/assets/campus-resources.json',
  ];
  for (const entry of requiredEntries) {
    if (!entries.has(entry)) throw new Error(`missing required packaged file: ${entry}`);
  }
  assertNoTestOnlyPackageEntries(entries);

  const packagedIndex = asar.extractFile(archive, 'renderer/index.html').toString('utf8');
  const packagedRenderer = asar.extractFile(archive, 'renderer/app.js').toString('utf8');
  const packagedPreload = asar.extractFile(archive, 'preload.js').toString('utf8');
  const packagedMain = asar.extractFile(archive, 'main.js').toString('utf8');
  const packagedControlDataIpc = asar.extractFile(archive, 'lib/control-data-ipc.js')
    .toString('utf8');
  const packagedResourceIpc = asar.extractFile(archive, 'lib/campus-resource-ipc.js')
    .toString('utf8');
  const packagedResourceManager = asar.extractFile(archive, 'renderer/resource-manager.js')
    .toString('utf8');
  for (const helper of ['login-flow', 'resource-view']) {
    if (!packagedIndex.includes(`../lib/${helper}.js`)) {
      throw new Error(`renderer does not load its shared helper: ${helper}`);
    }
  }
  for (const feature of [
    'manager-view', 'routing-manager', 'certificate-manager', 'resource-manager',
    'proxy-auth-migration',
  ]) {
    const featureScript = packagedIndex.indexOf(`src="${feature}.js"`);
    const appScript = packagedIndex.indexOf('src="app.js"');
    if (featureScript < 0 || appScript < 0 || featureScript >= appScript) {
      throw new Error(`renderer does not load its feature before app: ${feature}`);
    }
  }
  for (const helper of ['evaluateLoginProgress', 'visibleResources', 'routeLabel']) {
    if (packagedRenderer.includes(`function ${helper}`)) {
      throw new Error(`renderer duplicates its shared helper: ${helper}`);
    }
  }
  if (!packagedRenderer.includes('window.loginFlow') ||
      !packagedRenderer.includes('window.resourceView')) {
    throw new Error('renderer does not consume the packaged shared helper APIs');
  }
  assertCustomResourceManager({
    html: packagedIndex,
    renderer: packagedRenderer,
    preload: packagedPreload,
    main: packagedMain,
    controlDataIpc: packagedControlDataIpc,
    resourceIpc: packagedResourceIpc,
    resourceRenderer: packagedResourceManager,
  });

  const platformName = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';
  const architectureName = architecture === 'arm64' ? 'arm64' : 'amd64';
  const extension = platformName === 'windows' ? '.exe' : '';
  const engineName = `ec-engine-${platformName}-${architectureName}${extension}`;
  const proxyCommandName = `ec-proxy-command-${platformName}-${architectureName}${extension}`;
  const engine = path.join(resources, 'engine', engineName);
  const proxyCommand = path.join(resources, 'engine', proxyCommandName);
  assertExactNativeResources(path.join(resources, 'engine'), [
    engineName,
    proxyCommandName,
    'hkustgz.json',
  ]);
  for (const [label, executable] of [['engine', engine], ['SSH proxy helper', proxyCommand]]) {
    if (!fs.existsSync(executable) || !fs.statSync(executable).isFile() || fs.statSync(executable).size === 0) {
      throw new Error(`missing packaged ${label}: ${executable}`);
    }
  }
  assertNoTestOnlyEngineMarker(engine);

  if (platformName === 'windows') {
    for (const executable of [engine, proxyCommand]) {
      const header = fs.readFileSync(executable);
      const peOffset = header.length >= 0x40 ? header.readUInt32LE(0x3c) : -1;
      const signature = peOffset >= 0 && peOffset + 6 <= header.length
        ? header.subarray(peOffset, peOffset + 4).toString('binary')
        : '';
      const machine = signature === 'PE\u0000\u0000' ? header.readUInt16LE(peOffset + 4) : -1;
      const expectedMachine = architectureName === 'arm64' ? 0xaa64 : 0x8664;
      if (machine !== expectedMachine) {
        throw new Error(
          `packaged binary is not a ${architectureName} Windows PE executable: ${executable}`,
        );
      }
    }
  } else if (platformName === 'linux') {
    for (const executable of [engine, proxyCommand]) {
      assertLinuxElfArchitecture(executable, architectureName);
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
  TEST_ONLY_ENGINE_MARKER,
  assertLinuxElfArchitecture,
  assertCustomResourceManager,
  assertExactNativeResources,
  assertNoTestOnlyEngineMarker,
  assertNoTestOnlyNativeResources,
  assertNoTestOnlyPackageEntries,
  parseArguments,
  readMacSignature,
  resolveMacAppPath,
  resolveResourcesDirectory,
  verifyPackage,
};

if (require.main === module) {
  process.stdout.write(`${verifyPackage(parseArguments(process.argv.slice(2)))}\n`);
}
