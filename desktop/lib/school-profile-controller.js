'use strict';

const { mergeCampusResources } = require('./campus-resources');
const { createActiveSchoolProfileContext } = require('./school-profile-runtime');

function createSchoolProfileController(options = {}) {
  const context = createActiveSchoolProfileContext(options);
  const { profile } = context;
  const builtInResources = profile.browser.builtinResources;

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
    mergeResources(customResources = []) {
      return mergeCampusResources(builtInResources, customResources);
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
