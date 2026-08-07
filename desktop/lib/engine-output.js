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

module.exports = { classifyEngineOutput, engineFailureKind };
