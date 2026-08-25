'use strict';

const { registerCampusResourceIpc } = require('./campus-resource-ipc');
const { registerCertificatePinIpc } = require('./certificate-pin-ipc');
const { registerRoutingRuleIpc } = require('./routing-rule-ipc');
const { registerSchoolProfileOnboardingIpc } = require('./school-profile-onboarding-ipc');
const { registerSchoolProfileSwitchIpc } = require('./school-profile-switch-ipc');

function registerControlDataIpc({ register, routing, certificates, resources, schools } = {}) {
  registerRoutingRuleIpc({ register, ...routing });
  registerCertificatePinIpc({ register, ...certificates });
  registerCampusResourceIpc({ register, ...resources });
  registerSchoolProfileOnboardingIpc({ register, ...schools });
  registerSchoolProfileSwitchIpc({ register, switchProfile: schools?.switchProfile });
}

module.exports = {
  registerControlDataIpc,
};
