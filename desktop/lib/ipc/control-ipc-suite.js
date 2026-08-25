'use strict';

const { registerControlDataIpc } = require('./control-data-ipc');
const { registerCoreControlIpc } = require('./core-control-ipc');
const { registerSettingsCredentialIpc } = require('./settings-credential-ipc');
const { createControlStateSnapshot } = require('./control-state-snapshot');
const { CustomProfileDeletionRuntime } = require('../profiles/deletion/custom-profile-deletion-runtime');
const {
  createSchoolProfileOnboardingRuntime,
} = require('../profiles/onboarding/school-profile-onboarding-suite');
const {
  createExternalIntegrationRuntime,
  createIntegrationTargetSelector,
} = require('./integration-center-suite');

module.exports = {
  createCustomProfileDeletionRuntime: (options) => new CustomProfileDeletionRuntime(options),
  createControlStateSnapshot,
  createExternalIntegrationRuntime,
  createIntegrationTargetSelector,
  createSchoolProfileOnboardingRuntime,
  registerControlDataIpc,
  registerCoreControlIpc,
  registerSettingsCredentialIpc,
};
