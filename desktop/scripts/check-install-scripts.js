'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_INSTALL_SCRIPTS = Object.freeze([
  'electron-winstaller@5.4.0',
]);

function packageNameFromLockPath(value) {
  if (typeof value !== 'string' || !value.includes('node_modules/')) {
    throw new TypeError('install-script package path is invalid');
  }
  const name = value.slice(value.lastIndexOf('node_modules/') + 'node_modules/'.length);
  if (!name || name.includes('/node_modules/') || name.includes('..')) {
    throw new TypeError('install-script package name is invalid');
  }
  return name;
}

function installScriptPackages(lockDocument) {
  if (!lockDocument || typeof lockDocument !== 'object' || Array.isArray(lockDocument) ||
      !lockDocument.packages || typeof lockDocument.packages !== 'object' ||
      Array.isArray(lockDocument.packages)) {
    throw new TypeError('package lock has an invalid schema');
  }
  const packages = [];
  for (const [lockPath, value] of Object.entries(lockDocument.packages)) {
    if (!value || typeof value !== 'object' || value.hasInstallScript !== true) continue;
    if (typeof value.version !== 'string' || !value.version) {
      throw new TypeError('install-script package version is invalid');
    }
    packages.push(`${packageNameFromLockPath(lockPath)}@${value.version}`);
  }
  return Object.freeze(packages.sort());
}

function verifyInstallScriptAllowlist(lockDocument, allowlist = ALLOWED_INSTALL_SCRIPTS) {
  const packages = installScriptPackages(lockDocument);
  const allowed = new Set(allowlist);
  const unexpected = packages.filter((value) => !allowed.has(value));
  if (unexpected.length) {
    throw new Error(`unexpected dependency install scripts: ${unexpected.join(', ')}`);
  }
  return packages;
}

function main() {
  const lockPath = path.resolve(__dirname, '..', 'package-lock.json');
  const lockDocument = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const packages = verifyInstallScriptAllowlist(lockDocument);
  process.stdout.write(
    `dependency install-script gate: PASS (allowlisted=${packages.length})\n`,
  );
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`dependency install-script gate: FAIL (${error.message})\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_INSTALL_SCRIPTS,
  installScriptPackages,
  packageNameFromLockPath,
  verifyInstallScriptAllowlist,
};
