'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const [resourcesArgument, platform = process.platform, architecture = process.arch] =
  process.argv.slice(2);

if (!resourcesArgument) {
  throw new Error('usage: node build/verify-package.js <resources-dir> [platform] [arch]');
}

const resources = path.resolve(resourcesArgument);
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
  '/lib/settings-update.js',
  '/renderer/app.js',
  '/renderer/campus-browser.html',
  '/renderer/campus-browser.js',
  '/renderer/campus-browser.css',
  '/assets/campus-resources.json',
];
for (const entry of requiredEntries) {
  if (!entries.has(entry)) throw new Error(`missing required packaged file: ${entry}`);
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

process.stdout.write(
  `verified ${platformName}/${architectureName}: campus browser, settings update, engine, v${packagedManifest.version}\n`,
);
