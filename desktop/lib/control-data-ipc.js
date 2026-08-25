'use strict';

const { registerCampusResourceIpc } = require('./campus-resource-ipc');
const { registerCertificatePinIpc } = require('./certificate-pin-ipc');
const { registerRoutingRuleIpc } = require('./routing-rule-ipc');
const { registerSchoolProfileOnboardingIpc } = require('./profiles/onboarding/school-profile-onboarding-ipc');
const { registerSchoolProfileSwitchIpc } = require('./profiles/onboarding/school-profile-switch-ipc');
const { registerIntegrationCenterIpc } = require('./integration-center-ipc');

function registerControlDataIpc({ register, routing, certificates, resources, schools, integrations } = {}) {
  registerRoutingRuleIpc({ register, ...routing });
  registerCertificatePinIpc({ register, ...certificates });
  registerCampusResourceIpc({ register, ...resources });
  registerSchoolProfileOnboardingIpc({ register, ...schools });
  registerSchoolProfileSwitchIpc({ register, switchProfile: schools?.switchProfile });
  registerIntegrationCenterIpc({ register, runtime: integrations });
}

module.exports = {
  registerControlDataIpc,
};
