'use strict';

const { registerControlDataIpc } = require('./control-data-ipc');
const { registerCoreControlIpc } = require('./core-control-ipc');
const { registerSettingsCredentialIpc } = require('./settings-credential-ipc');
const { createControlStateSnapshot } = require('./control-state-snapshot');
const {
  createSchoolProfileOnboardingRuntime,
} = require('./school-profile-onboarding-suite');
const {
  createExternalIntegrationRuntime,
  createIntegrationTargetSelector,
  createLegacyExternalProxyActions,
} = require('./integration-center-suite');

module.exports = {
  createControlStateSnapshot,
  createExternalIntegrationRuntime,
  createIntegrationTargetSelector,
  createLegacyExternalProxyActions,
  createSchoolProfileOnboardingRuntime,
  registerControlDataIpc,
  registerCoreControlIpc,
  registerSettingsCredentialIpc,
};
