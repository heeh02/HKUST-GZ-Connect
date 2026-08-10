'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const {
  allowedKeys,
  assertTrustedIpcSender,
  boundedArray,
  boundedString,
  enumValue,
  isTrustedIpcSender,
  plainObject,
} = require('../lib/ipc-guard');

test('accepts only the expected WebContents at an explicitly allowed local file', () => {
  const localFile = path.resolve('/app/renderer/index.html');
  const webContents = { getURL: () => pathToFileURL(localFile).href };
  const event = { sender: webContents, senderFrame: { url: `${pathToFileURL(localFile).href}?lang=zh` } };
  assert.equal(isTrustedIpcSender(event, { webContents, allowedFiles: [localFile] }), true);
  assert.equal(isTrustedIpcSender({ ...event, sender: {} }, { webContents, allowedFiles: [localFile] }), false);
  assert.equal(isTrustedIpcSender({
    sender: webContents, senderFrame: { url: 'https://campus.example/' },
  }, { webContents, allowedFiles: [localFile] }), false);
  assert.throws(() => assertTrustedIpcSender(event, {
    webContents, allowedFiles: ['/app/renderer/other.html'],
  }), /不受信任/);
});

test('strict validators reject coercion, oversized arrays, invalid enums, and prototypes', () => {
  assert.equal(boundedString(' route ', { maxLength: 20, trim: true }), 'route');
  assert.throws(() => boundedString(123), /文本/);
  assert.throws(() => boundedString('x'.repeat(10), { maxLength: 3 }), /文本/);
  assert.equal(enumValue('direct', ['campus', 'direct']), 'direct');
  assert.throws(() => enumValue('system', ['campus', 'direct']), /选项/);
  assert.deepEqual(boundedArray(['a', 'b'], (item) => boundedString(item)), ['a', 'b']);
  assert.throws(() => boundedArray(Array(129).fill('a'), String), /列表/);
  assert.equal(plainObject({ ok: true }).ok, true);
  assert.throws(() => plainObject(Object.create({ inherited: true })), /格式/);
  assert.deepEqual(allowedKeys({ host: 'example.test' }, ['host']), { host: 'example.test' });
  assert.throws(() => allowedKeys({ host: 'example.test', token: 'secret' }, ['host']), /未知字段/);
});
