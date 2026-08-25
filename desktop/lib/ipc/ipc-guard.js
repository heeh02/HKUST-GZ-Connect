'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MAX_IPC_STRING = 4096;
const MAX_IPC_ARRAY = 128;

function normalizedFileFromUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (parsed.protocol !== 'file:' || parsed.username || parsed.password) return '';
    return path.resolve(fileURLToPath(parsed));
  } catch {
    return '';
  }
}

function isTrustedIpcSender(event, {
  webContents = null,
  allowedFiles = [],
} = {}) {
  if (!event || !event.sender || (webContents && event.sender !== webContents)) return false;
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  const senderFile = normalizedFileFromUrl(senderUrl);
  if (!senderFile) return false;
  const allowed = (Array.isArray(allowedFiles) ? allowedFiles : [allowedFiles])
    .filter((value) => typeof value === 'string' && value)
    .map((value) => path.resolve(value));
  return allowed.includes(senderFile);
}

function assertTrustedIpcSender(event, options) {
  if (!isTrustedIpcSender(event, options)) throw new Error('不受信任的应用内请求');
}

function plainObject(value, message = '请求格式无效') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(message);
  }
  return value;
}

function allowedKeys(value, allowed, message = '请求包含未知字段') {
  const object = plainObject(value);
  if (!Array.isArray(allowed) || Object.keys(object).some((key) => !allowed.includes(key))) {
    throw new TypeError(message);
  }
  return object;
}

function boundedString(value, {
  maxLength = MAX_IPC_STRING,
  minLength = 0,
  trim = false,
  message = '请求文本无效',
} = {}) {
  if (typeof value !== 'string') throw new TypeError(message);
  const result = trim ? value.trim() : value;
  if (result.length < minLength || result.length > maxLength || /[\u0000]/u.test(result)) {
    throw new TypeError(message);
  }
  return result;
}

function enumValue(value, allowed, message = '请求选项无效') {
  if (!Array.isArray(allowed) || !allowed.includes(value)) throw new TypeError(message);
  return value;
}

function boundedArray(value, validator, {
  maxLength = MAX_IPC_ARRAY,
  message = '请求列表无效',
} = {}) {
  if (!Array.isArray(value) || value.length > maxLength || typeof validator !== 'function') {
    throw new TypeError(message);
  }
  return value.map((item, index) => validator(item, index));
}

module.exports = {
  MAX_IPC_ARRAY,
  MAX_IPC_STRING,
  assertTrustedIpcSender,
  allowedKeys,
  boundedArray,
  boundedString,
  enumValue,
  isTrustedIpcSender,
  normalizedFileFromUrl,
  plainObject,
};
