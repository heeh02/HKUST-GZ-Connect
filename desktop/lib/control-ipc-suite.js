'use strict';

const { registerControlDataIpc } = require('./control-data-ipc');
const { registerCoreControlIpc } = require('./core-control-ipc');
const { registerSettingsCredentialIpc } = require('./settings-credential-ipc');
const { createControlStateSnapshot } = require('./control-state-snapshot');
const {
  createSchoolProfileOnboardingRuntime,
} = require('./school-profile-onboarding-suite');

module.exports = {
  createControlStateSnapshot,
  createSchoolProfileOnboardingRuntime,
  registerControlDataIpc,
  registerCoreControlIpc,
  registerSettingsCredentialIpc,
};
