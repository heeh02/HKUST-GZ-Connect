'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  createLegacyPrimaryAccountView,
  createLegacyWorkspaceView,
  normalizeGatewayOrigin,
} = require('../schema/school-profile-schema');
const { SchoolProfileRegistry } = require('../registry/school-profile-registry');

const MAX_ENGINE_CONFIG_BYTES = 256 * 1024;
const SAFE_PROFILE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function readRegularFileNoFollow(file, { fsImpl = fs, maxBytes = MAX_ENGINE_CONFIG_BYTES } = {}) {
  const stat = fsImpl.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) {
    throw new Error('engine profile config must be a bounded regular file');
  }
  const descriptor = fsImpl.openSync(
    file,
    Number(fsImpl.constants?.O_RDONLY || 0) |
      Number(fsImpl.constants?.O_NOFOLLOW || 0) |
      Number(fsImpl.constants?.O_NONBLOCK || 0),
  );
  try {
    const opened = fsImpl.fstatSync(descriptor);
    if (!opened.isFile() || (Number.isInteger(opened.dev) && Number.isInteger(opened.ino) &&
        (opened.dev !== stat.dev || opened.ino !== stat.ino))) {
      throw new Error('engine profile config changed while opening');
    }
    const data = fsImpl.readFileSync(descriptor);
    if (!Buffer.isBuffer(data) || data.length !== opened.size || data.length > maxBytes) {
      throw new Error('engine profile config changed while reading');
    }
    return data;
  } finally {
    fsImpl.closeSync(descriptor);
  }
}

function parseEngineConfig(data) {
  let value;
  try { value = JSON.parse(data.toString('utf8')); }
  catch { throw new Error('engine profile config is not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.base_url !== 'string') {
    throw new Error('engine profile config has an invalid schema');
  }
  return value;
}

function engineConfigCandidate({ profile, isPackaged, resourcesPath, desktopDir }) {
  const profileId = profile?.profileId;
  if (typeof profileId !== 'string' || !SAFE_PROFILE_ID.test(profileId) ||
      typeof profile?.gateway?.engineConfigRef !== 'string' || !profile.gateway.engineConfigRef) {
    throw new Error('school profile engine config is not compiled into this build');
  }
  const filename = `${profileId}.json`;
  if (isPackaged) {
    if (typeof resourcesPath !== 'string' || !path.isAbsolute(resourcesPath)) {
      throw new Error('packaged resources path is invalid');
    }
    return path.join(resourcesPath, 'engine', filename);
  }
  if (typeof desktopDir !== 'string' || !path.isAbsolute(desktopDir)) {
    throw new Error('desktop source path is invalid');
  }
  return path.join(desktopDir, '..', 'independent', 'config', filename);
}

function verifyEngineConfigBinding({
  registry,
  profile,
  isPackaged,
  resourcesPath,
  desktopDir,
  fsImpl = fs,
} = {}) {
  if (!registry || !profile) throw new TypeError('active school profile is incomplete');
  const candidate = engineConfigCandidate({ profile, isPackaged, resourcesPath, desktopDir });
  const data = readRegularFileNoFollow(candidate, { fsImpl });
  const descriptor = registry.resolveAsset(
    profile.profileId,
    profile.gateway.engineConfigRef,
    'engine-config',
  );
  if (sha256(data) !== descriptor.sha256 ||
      !data.equals(registry.readAsset(profile.profileId, descriptor.key, 'engine-config'))) {
    throw new Error('engine profile config does not match its reviewed package binding');
  }
  const config = parseEngineConfig(data);
  if (normalizeGatewayOrigin(config.base_url).origin !== profile.gateway.origin.origin) {
    throw new Error('engine profile config Gateway origin does not match the active profile');
  }
  if (config.gateway_connector?.reviewed_private_gateway_allowed !==
      profile.policy.reviewedPrivateGatewayAllowed) {
    throw new Error('engine profile config private Gateway policy does not match the active profile');
  }
  return Object.freeze({ path: candidate, sha256: descriptor.sha256 });
}

function createActiveSchoolProfileContext({
  packageRoot,
  isPackaged = false,
  resourcesPath = '',
  desktopDir,
  fsImpl = fs,
  registry = null,
} = {}) {
  const profiles = registry || new SchoolProfileRegistry({ packageRoot, fsImpl }).load();
  const profile = profiles.getDefaultProfile();
  const verifyConfig = () => verifyEngineConfigBinding({
    registry: profiles,
    profile,
    isPackaged,
    resourcesPath,
    desktopDir,
    fsImpl,
  });
  const initialConfig = verifyConfig();
  return Object.freeze({
    registry: profiles,
    profile,
    builtinResources: profiles.getBuiltinResources(profile.profileId),
    gatewayHost: profile.gateway.origin.hostname.replace(/^\[|\]$/gu, ''),
    gatewayPort: profile.gateway.origin.port,
    engineConfigPath: initialConfig.path,
    verifyEngineConfig: verifyConfig,
    createProfileView: (options) => profiles.createDefaultView(options),
    createLegacyPrimaryAccountView,
    createLegacyWorkspaceView,
  });
}

module.exports = {
  MAX_ENGINE_CONFIG_BYTES,
  createActiveSchoolProfileContext,
  engineConfigCandidate,
  parseEngineConfig,
  readRegularFileNoFollow,
  verifyEngineConfigBinding,
};
