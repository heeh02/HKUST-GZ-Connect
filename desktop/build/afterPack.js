'use strict';
// Ad-hoc re-sign the whole .app AFTER electron-builder copies extraResources
// (the bundled native Rust engine). Without this the bundle seal is invalid once
// the engine is added, and Gatekeeper shows the harsh "is damaged" block with no
// override. A VALID ad-hoc signature downgrades that to "cannot be verified",
// which the user can bypass with right-click -> Open (no Terminal needed).
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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

exports.default = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}${context.electronPlatformName === 'darwin' ? '.app' : ''}`);
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? path.join(appPath, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  assertEnginePresent(path.join(resourcesDir, 'engine'), context.electronPlatformName, context.arch);
  if (context.electronPlatformName !== 'darwin') return;
  // If a real Developer ID cert is provided, let electron-builder sign+notarize
  // instead — don't clobber it with an ad-hoc signature.
  if (process.env.CSC_LINK || process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'true') {
    console.log('[afterPack] real cert present — skipping ad-hoc signing');
    return;
  }
  const engineDir = path.join(appPath, 'Contents', 'Resources', 'engine');
  const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

  // sign nested engine binaries first, then seal the whole bundle
  if (fs.existsSync(engineDir)) {
    for (const f of fs.readdirSync(engineDir)) {
      const p = path.join(engineDir, f);
      if (fs.statSync(p).isFile()) run(`codesign --force --timestamp=none -s - "${p}"`);
    }
  }
  run(`codesign --force --deep --timestamp=none -s - "${appPath}"`);
  run(`codesign --verify --deep --strict "${appPath}"`);
  console.log('[afterPack] ad-hoc signed + verified:', appPath);
};
