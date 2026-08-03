'use strict';
// Re-sign the whole .app after electron-builder copies extraResources (the
// bundled native Rust engine). Prefer a stable Apple identity so macOS sees the
// same designated requirement across local builds; use ad-hoc only when no
// Apple identity is available. A release pipeline can instead supply CSC_LINK
// or explicit identity auto-discovery and remain fully electron-builder owned.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const {
  parseCodeSigningIdentities,
  selectLocalAppleIdentity,
  shouldDelegateSigning,
} = require('./macos-signing');

function architectureName(arch) {
  return arch === 'arm64' || arch === 3 ? 'arm64' : 'amd64';
}

function requiredEngineName(platform, arch) {
  const platformName = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';
  const extension = platformName === 'windows' ? '.exe' : '';
  return `ec-engine-${platformName}-${architectureName(arch)}${extension}`;
}

function assertEnginePresent(resourcesDir, platform, arch) {
  const name = requiredEngineName(platform, arch);
  const enginePath = path.join(resourcesDir, name);
  if (!fs.existsSync(enginePath) || !fs.statSync(enginePath).isFile() || fs.statSync(enginePath).size === 0) {
    throw new Error(`missing packaged engine: ${enginePath}`);
  }
  return enginePath;
}

exports.architectureName = architectureName;
exports.requiredEngineName = requiredEngineName;
exports.assertEnginePresent = assertEnginePresent;

function discoverLocalAppleIdentity() {
  try {
    const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return selectLocalAppleIdentity(parseCodeSigningIdentities(output));
  } catch {
    // An unsigned development machine remains usable, but this fallback is
    // deliberately visible in the package log and never masks a sign failure.
    return null;
  }
}

function signMacPackage(appPath, enginePath, identity) {
  const signer = identity ? identity.hash : '-';
  const timestamp = identity && identity.kind === 'developer-id' ? '--timestamp' : '--timestamp=none';
  const run = (args) => execFileSync('codesign', args, { stdio: 'inherit' });

  // Sign the extra native executable first, then seal its containing app.
  // Do not catch these calls: silently falling back after a selected Apple
  // identity fails would produce a misleading package.
  run(['--force', timestamp, '--sign', signer, enginePath]);
  run(['--force', '--deep', timestamp, '--sign', signer, appPath]);
  run(['--verify', '--deep', '--strict', appPath]);
}

exports.discoverLocalAppleIdentity = discoverLocalAppleIdentity;
exports.signMacPackage = signMacPackage;

exports.default = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}${context.electronPlatformName === 'darwin' ? '.app' : ''}`);
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? path.join(appPath, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const enginePath = assertEnginePresent(
    path.join(resourcesDir, 'engine'), context.electronPlatformName, context.arch,
  );
  if (context.electronPlatformName !== 'darwin') return;
  if (shouldDelegateSigning(process.env)) {
    console.log('[afterPack] release signing configured — leaving signing to electron-builder');
    return;
  }
  const identity = discoverLocalAppleIdentity();
  signMacPackage(appPath, enginePath, identity);
  console.log(`[afterPack] ${identity ? identity.kind : 'ad-hoc'} signed + verified:`, appPath);
};
