'use strict';

const crypto = require('node:crypto');
const { mergeCampusResources, projectCampusResources } = require('./campus-resources');
const { createActiveSchoolProfileContext } = require('./school-profile-runtime');
const { createCapabilitySnapshot } = require('./school-profile-schema');

const CURRENT_PROFILE_CAPABILITIES = new Set(['auth.password', 'transport.l3']);

function selectedCapabilityLayer(keys) {
  return Object.fromEntries(keys.map((capability) => [
    capability,
    CURRENT_PROFILE_CAPABILITIES.has(capability) ? 'supported' : 'unsupported',
  ]));
}

function createSchoolProfileController(options = {}) {
  const context = createActiveSchoolProfileContext(options);
  const { profile } = context;
  const builtInResources = context.builtinResources;
  const randomBytes = typeof options.randomBytes === 'function' ? options.randomBytes : crypto.randomBytes;
  const accountEntropy = randomBytes(18);
  if (!Buffer.isBuffer(accountEntropy) || accountEntropy.length !== 18) {
    throw new TypeError('account handle entropy is invalid');
  }
  const accountHandle = `account-${accountEntropy.toString('base64url')}`;
  accountEntropy.fill(0);
  const activeContextEpoch = 1;
  let currentCapabilitySnapshot = null;

  function capabilitySnapshotFromReport(report) {
    if (!report || report.profileId !== profile.profileId ||
        report.profileRevision !== profile.profileRevision ||
        !Number.isSafeInteger(report.engineGeneration) || report.engineGeneration <= 0) {
      throw new TypeError('provider capability report does not match the active profile');
    }
    const keys = Object.keys(report.compiled).sort();
    return createCapabilitySnapshot({
      profileId: profile.profileId,
      profileRevision: profile.profileRevision,
      accountHandle,
      activeContextEpoch,
      engineGeneration: report.engineGeneration,
      compiled: report.compiled,
      provider: report.provider,
      profile: selectedCapabilityLayer(keys),
      ingress: selectedCapabilityLayer(keys),
    });
  }

  return Object.freeze({
    gatewayHost: context.gatewayHost,
    gatewayPort: context.gatewayPort,
    engineConfigPath: context.engineConfigPath,
    defaultRouteDomains: profile.browser.campusDomains,
    directPartnerDomains: profile.browser.directPartnerDomains,
    browserHomeUrl: profile.browser.homeUrl,
    healthTargets: profile.browser.healthTargets,
    builtInResourceCount: builtInResources.length,
    verifyEngineConfig: context.verifyEngineConfig,
    verifyEngineLaunchBinding() {
      const verified = context.verifyEngineConfig();
      const stdinFrame = JSON.stringify({
        type: 'engine_config_binding',
        apiVersion: 1,
        configSha256: verified.sha256,
        gatewayOrigin: profile.gateway.origin.origin,
        profileId: profile.profileId,
        profileRevision: profile.profileRevision,
        protocolFamily: profile.gateway.protocolFamily,
      });
      if (Buffer.byteLength(stdinFrame, 'utf8') > 1024) {
        throw new Error('engine profile binding frame is too large');
      }
      return Object.freeze({
        path: verified.path,
        stdinFrame,
      });
    },
    mergeResources(customResources = []) {
      return mergeCampusResources(builtInResources, customResources);
    },
    projectResources(customResources = []) {
      return projectCampusResources(builtInResources, customResources);
    },
    createCapabilitySnapshot: capabilitySnapshotFromReport,
    observeCapabilityReport(report) {
      try {
        currentCapabilitySnapshot = capabilitySnapshotFromReport(report);
        return true;
      } catch {
        return false;
      }
    },
    clearCapabilitySnapshot() {
      const changed = currentCapabilitySnapshot !== null;
      currentCapabilitySnapshot = null;
      return changed;
    },
    capabilitySnapshot() {
      return currentCapabilitySnapshot;
    },
    createPresentation({
      locale = 'zh',
      hasCredential = false,
      resourceCount = builtInResources.length,
    } = {}) {
      return Object.freeze({
        schoolProfile: context.createProfileView({ locale, compatibility: 'reviewed' }),
        campusAccount: context.createLegacyPrimaryAccountView({
          accountHandle,
          hasCredential,
          isActive: true,
        }),
        workspace: context.createLegacyWorkspaceView({ accountHandle, resourceCount }),
      });
    },
  });
}

module.exports = { createSchoolProfileController };
