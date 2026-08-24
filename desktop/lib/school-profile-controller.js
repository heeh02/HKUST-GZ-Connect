'use strict';

const { mergeCampusResources, projectCampusResources } = require('./campus-resources');
const { createActiveSchoolProfileContext } = require('./school-profile-runtime');

function createSchoolProfileController(options = {}) {
  const context = createActiveSchoolProfileContext(options);
  const { profile } = context;
  const builtInResources = context.builtinResources;

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
    createPresentation({
      locale = 'zh',
      hasCredential = false,
      resourceCount = builtInResources.length,
    } = {}) {
      return Object.freeze({
        schoolProfile: context.createProfileView({ locale, compatibility: 'reviewed' }),
        campusAccount: context.createLegacyPrimaryAccountView({
          hasCredential,
          isActive: true,
        }),
        workspace: context.createLegacyWorkspaceView({ resourceCount }),
      });
    },
  });
}

module.exports = { createSchoolProfileController };
