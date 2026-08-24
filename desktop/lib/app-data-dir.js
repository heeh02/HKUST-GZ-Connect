'use strict';

const path = require('path');
const { createLegacyRuntimeStoragePaths } = require('./runtime-storage-paths');

function resolveUserDataOverride(rawValue) {
  if (rawValue == null || String(rawValue).trim() === '') return null;
  const candidate = String(rawValue).trim();
  if (!path.isAbsolute(candidate)) {
    throw new Error('HKUSTGZ_USER_DATA_DIR must be an absolute path');
  }
  return path.resolve(candidate);
}

module.exports = { createLegacyRuntimeStoragePaths, resolveUserDataOverride };
