'use strict';

const { registerControlDataIpc } = require('./control-data-ipc');
const { registerCoreControlIpc } = require('./core-control-ipc');
const { registerSettingsCredentialIpc } = require('./settings-credential-ipc');

module.exports = {
  registerControlDataIpc,
  registerCoreControlIpc,
  registerSettingsCredentialIpc,
};
