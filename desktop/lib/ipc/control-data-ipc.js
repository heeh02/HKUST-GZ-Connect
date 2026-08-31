'use strict';

const { registerCampusResourceIpc } = require('./campus-resource-ipc');
const { registerBrowserDataIpc } = require('./browser-data-ipc');
const { registerCardBoardIpc } = require('./card-board-ipc');
const { registerCertificatePinIpc } = require('./certificate-pin-ipc');
const { registerRoutingRuleIpc } = require('./routing-rule-ipc');
const { registerSchoolProfileOnboardingIpc } = require('./school-profile-onboarding-ipc');
const { registerSchoolProfileSwitchIpc } = require('./school-profile-switch-ipc');
const { registerIntegrationCenterIpc } = require('./integration-center-ipc');

function registerControlDataIpc({ register, routing, certificates, resources, cardBoard, schools, integrations, browser } = {}) {
  registerRoutingRuleIpc({ register, ...routing });
  registerCertificatePinIpc({ register, ...certificates });
  registerCampusResourceIpc({ register, ...resources });
  registerCardBoardIpc({ register: cardBoard?.register || register, ...cardBoard });
  registerSchoolProfileOnboardingIpc({ register, ...schools });
  registerSchoolProfileSwitchIpc({ register, switchProfile: schools?.switchProfile });
  registerIntegrationCenterIpc({ register, runtime: integrations });
  registerBrowserDataIpc({ register, ...browser });
}

module.exports = {
  registerControlDataIpc,
};
