'use strict';

const { registerControlDataIpc } = require('./control-data-ipc');
const { registerCoreControlIpc } = require('./core-control-ipc');
const { registerSettingsCredentialIpc } = require('./settings-credential-ipc');
const { createControlStateSnapshot } = require('./control-state-snapshot');

module.exports = {
  createControlStateSnapshot,
  registerControlDataIpc,
  registerCoreControlIpc,
  registerSettingsCredentialIpc,
};
