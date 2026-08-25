'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LEGACY_SOURCE_MAX_BYTES,
  collectLegacyFlatSourceReceipts,
  collectPrivateFileReceipt,
} = require('./legacy-flat-source-receipts');
const {
  LEGACY_SOURCE_IDS,
  legacySourceReceiptDigest,
} = require('./profile-workspace-migration-journal');
const { createLegacyFlatSourcePaths } = require('./profile-workspace-layout');
const { verifyWindowsFileOwnerOnly } = require('./windows-private-file');

function sameReceipt(left, right) {
  return left.present === right.present && left.bytes === right.bytes && left.sha256 === right.sha256;
}

function fsyncDirectory(directory, fileSystem, platform) {
  let descriptor = null;
  try {
    descriptor = fileSystem.openSync(directory, 'r');
    fileSystem.fsyncSync?.(descriptor);
    return true;
  } catch {
    return platform === 'win32';
  } finally {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
  }
}

function retireLegacyFlatSources({
  userData,
  expectedReceipts,
  fileSystem = fs,
  platform = process.platform,
  windowsAcl = { verify: verifyWindowsFileOwnerOnly },
} = {}) {
  if (!fileSystem || typeof fileSystem.unlinkSync !== 'function' ||
      !['darwin', 'linux', 'win32'].includes(platform) ||
      (platform === 'win32' && typeof windowsAcl?.verify !== 'function')) {
    throw new TypeError('legacy retirement dependencies are invalid');
  }
  // Validates exact receipt IDs and shapes before any deletion.
  legacySourceReceiptDigest(expectedReceipts);
  const paths = createLegacyFlatSourcePaths(userData);
  const current = collectLegacyFlatSourceReceipts({ userData, fileSystem, platform, windowsAcl });
  for (const id of LEGACY_SOURCE_IDS) {
    if (!expectedReceipts[id].present && current[id].present) {
      throw new Error(`unexpected legacy source appeared: ${id}`);
    }
    if (expectedReceipts[id].present && current[id].present &&
        !sameReceipt(expectedReceipts[id], current[id])) {
      throw new Error(`legacy source receipt changed: ${id}`);
    }
  }

  // Keep the flat settings authority until every other matched source has
  // retired. A committed journal makes partial retirement safely resumable.
  const order = [...LEGACY_SOURCE_IDS.filter((id) => id !== 'settings'), 'settings'];
  for (const id of order) {
    if (!expectedReceipts[id].present) continue;
    const observed = collectPrivateFileReceipt({
      file: paths[id],
      maxBytes: LEGACY_SOURCE_MAX_BYTES[id],
      fileSystem,
      platform,
      windowsAcl,
      label: 'legacy source',
    });
    if (!observed.present) continue;
    if (!sameReceipt(observed, expectedReceipts[id])) {
      throw new Error(`legacy source receipt changed: ${id}`);
    }
    try {
      fileSystem.unlinkSync(paths[id]);
    } catch (error) {
      throw new Error(`legacy source retirement failed: ${id}`, { cause: error });
    }
    if (!fsyncDirectory(path.dirname(paths[id]), fileSystem, platform)) {
      throw new Error(`legacy source retirement was not durable: ${id}`);
    }
  }

  const after = collectLegacyFlatSourceReceipts({ userData, fileSystem, platform, windowsAcl });
  if (LEGACY_SOURCE_IDS.some((id) => after[id].present)) {
    throw new Error('legacy source retirement is incomplete');
  }
  return true;
}

module.exports = { retireLegacyFlatSources };
