'use strict';

const { isValidPort, normalizeSettings } = require('./settings-store');
const { normalizeRouteDomains } = require('./pac');

// The engine reads the account on one stdin line and the password on the next.
// A control character in either value would reframe that exchange, so it is
// rejected here with a message the user can act on instead of reaching the
// engine and failing as a generic credential-parse error.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function parsePort(value) {
  if (typeof value === 'string' && value.trim() === '') {
    throw new Error('SOCKS 端口不能为空');
  }
  const port = Number(value);
  if (!isValidPort(port)) {
    throw new Error('SOCKS 端口必须是 1025–65535 之间的整数');
  }
  return port;
}

function parseCredentialField(value, label) {
  const text = String(value);
  if (CONTROL_CHARACTERS.test(text)) {
    throw new Error(`${label}不能包含换行或控制字符`);
  }
  return text;
}

function applySettingsPatch(previous, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const next = { ...normalizeSettings(previous) };

  if (source.username != null) {
    next.username = parseCredentialField(source.username, '账号');
  }
  if (source.password != null) parseCredentialField(source.password, '密码');
  if (source.port != null) next.port = parsePort(source.port);
  if (source.maxAttempts != null) {
    const attempts = Number(source.maxAttempts);
    if (!Number.isInteger(attempts) || attempts < 0 || attempts > 10) {
      throw new Error('重试次数必须是 0–10 之间的整数');
    }
    next.maxAttempts = attempts;
  }
  if (source.routeDomains != null) next.routeDomains = normalizeRouteDomains(source.routeDomains);
  if (source.closeAction != null) {
    if (!['ask', 'minimize', 'quit'].includes(source.closeAction)) {
      throw new Error('关闭窗口行为无效');
    }
    next.closeAction = source.closeAction;
  }
  if (source.language != null) {
    if (!['auto', 'zh', 'en'].includes(source.language)) {
      throw new Error('语言设置无效');
    }
    next.language = source.language;
  }
  for (const key of ['autoReconnect', 'startAtLogin', 'autoConnect']) {
    if (source[key] != null) {
      if (typeof source[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
      next[key] = source[key];
    }
  }

  return {
    settings: normalizeSettings(next),
    portChanged: next.port !== normalizeSettings(previous).port,
  };
}

module.exports = { applySettingsPatch, parseCredentialField, parsePort };
