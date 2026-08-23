'use strict';

const { registerCampusResourceIpc } = require('./campus-resource-ipc');
const { registerCertificatePinIpc } = require('./certificate-pin-ipc');
const { registerRoutingRuleIpc } = require('./routing-rule-ipc');

function registerControlDataIpc({ register, routing, certificates, resources } = {}) {
  registerRoutingRuleIpc({ register, ...routing });
  registerCertificatePinIpc({ register, ...certificates });
  registerCampusResourceIpc({ register, ...resources });
}

module.exports = {
  registerControlDataIpc,
};
