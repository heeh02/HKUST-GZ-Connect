'use strict';

const { CustomGatewayConfirmationOwner } = require('./custom-gateway-onboarding');
const { CustomProfileProvisioningRuntime } = require('./custom-profile-provisioning-runtime');
const { GatewayProbeRunner } = require('./gateway-probe-runner');
const { SchoolProfileOnboardingCoordinator } = require('./school-profile-onboarding');

function createSchoolProfileOnboardingRuntime({
  userData,
  executablePath,
  spawnProcess,
  environment = process.env,
  platform = process.platform,
  getActiveContext,
  listProfiles,
  onDiagnostic,
} = {}) {
  const probeRunner = new GatewayProbeRunner({
    executablePath,
    spawnProcess,
    environment,
    platform,
  });
  return new SchoolProfileOnboardingCoordinator({
    probeRunner,
    confirmationOwner: new CustomGatewayConfirmationOwner(),
    provisioningRuntime: new CustomProfileProvisioningRuntime({ userData }),
    getActiveContext,
    listProfiles,
    onDiagnostic,
  });
}

module.exports = { createSchoolProfileOnboardingRuntime };
