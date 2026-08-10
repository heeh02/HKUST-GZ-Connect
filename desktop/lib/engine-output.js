'use strict';

const { createT } = require('./i18n');

function classifyEngineOutput(text, socksPort, t = createT('zh')) {
  if (/gateway authentication failed|login failed|invalid username/i.test(text)) {
    return t('engine.authFailed');
  }
  if (/not implemented auth|authentication method is unsupported/i.test(text)) {
    return t('engine.authUnsupported');
  }
  if (/cannot bind the SOCKS5 listener|address already in use|bind:/i.test(text)) {
    return t('engine.portBusy', { port: socksPort });
  }
  if (/modern address reply (?:has an unexpected status|rejected the request)/i.test(text)) {
    return t('error.gatewayRetrying');
  }
  if (/modern (?:address|send|receive) (?:TLS|request|reply):/i.test(text)) {
    return t('engine.channelClosed');
  }
  return null;
}

function engineFailureKind(text) {
  if (
    /gateway authentication failed|login failed|invalid username|not implemented auth|authentication method is unsupported/i
      .test(text)
  ) {
    return 'terminal';
  }
  if (/modern address reply (?:has an unexpected status|rejected the request)/i.test(text)) {
    return 'gateway-transient';
  }
  if (/modern (?:address|send|receive) (?:TLS|request|reply):/i.test(text)) {
    return 'gateway-transient';
  }
  return 'unknown';
}

function classifyEngineCode(code, socksPort, t = createT('zh')) {
  switch (code) {
    case 'AUTH_FAILED': return t('engine.authFailed');
    case 'UNSUPPORTED_AUTHENTICATION': return t('engine.authUnsupported');
    case 'CREDENTIALS_INVALID': return t('error.needCredentials');
    case 'INVALID_ARGUMENTS':
    case 'CONFIGURATION_INVALID': return t('engine.configurationInvalid');
    case 'LOCAL_LISTENER_FAILED': return t('engine.portBusy', { port: socksPort });
    case 'DATA_PLANE_SETUP_FAILED':
    case 'NETWORK_DISCONNECTED': return t('engine.channelClosed');
    case 'LOGOUT_FAILED':
    case 'SHUTDOWN_SIGNAL_FAILED': return t('error.engineStuck');
    case 'EVENT_OUTPUT_FAILED': return t('engine.eventOutputFailed');
    default: return t('error.connectFailed');
  }
}

function engineFailureKindFromCode(code) {
  if ([
    'AUTH_FAILED',
    'UNSUPPORTED_AUTHENTICATION',
    'CREDENTIALS_INVALID',
    'INVALID_ARGUMENTS',
    'CONFIGURATION_INVALID',
    'LOCAL_LISTENER_FAILED',
    'EVENT_OUTPUT_FAILED',
  ]
    .includes(code)) return 'terminal';
  if (['DATA_PLANE_SETUP_FAILED', 'NETWORK_DISCONNECTED'].includes(code)) {
    return 'gateway-transient';
  }
  return 'unknown';
}

function classifyEngineStopReason(reason, socksPort, t = createT('zh')) {
  switch (reason) {
    case 'user_requested': return null;
    case 'local_service_failed': return t('engine.portBusy', { port: socksPort });
    case 'network_unhealthy': return t('engine.channelClosed');
    case 'logout_failed':
    case 'shutdown_failed': return t('error.engineStuck');
    case 'event_output_failed': return t('engine.eventOutputFailed');
    case 'startup_failed': return t('error.connectFailed');
    default: return null;
  }
}

function engineFailureKindFromStopReason(reason) {
  if (['local_service_failed', 'logout_failed', 'shutdown_failed', 'event_output_failed']
    .includes(reason)) return 'terminal';
  if (reason === 'network_unhealthy') return 'gateway-transient';
  return 'unknown';
}

function resolveEngineFailureKind({ code = null, stopReason = null, diagnosticText = '' } = {}) {
  const codeKind = code ? engineFailureKindFromCode(code) : 'unknown';
  if (codeKind !== 'unknown') return codeKind;
  const stopKind = engineFailureKindFromStopReason(stopReason);
  if (stopKind !== 'unknown') return stopKind;
  return engineFailureKind(diagnosticText);
}

module.exports = {
  classifyEngineCode,
  classifyEngineOutput,
  classifyEngineStopReason,
  engineFailureKind,
  engineFailureKindFromCode,
  engineFailureKindFromStopReason,
  resolveEngineFailureKind,
};
