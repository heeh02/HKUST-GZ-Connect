'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { routeCertificateError } = require('../lib/certificate-error-boundary');

test('unowned certificate errors retain Chromium default handling', () => {
  let prevented = 0;
  let callbacks = 0;
  const result = routeCertificateError({
    owned: false,
    isMainFrame: true,
    event: { preventDefault: () => { prevented++; } },
    callback: () => { callbacks++; },
    prompt: () => { throw new Error('must not prompt'); },
  });
  assert.deepEqual(result, { handled: false, prompted: false });
  assert.equal(prevented, 0);
  assert.equal(callbacks, 0);
});

test('owned subresource certificate errors fail closed without a dialog', () => {
  let prevented = 0;
  const answers = [];
  let prompts = 0;
  const result = routeCertificateError({
    owned: true,
    isMainFrame: false,
    event: { preventDefault: () => { prevented++; } },
    callback: (allowed) => answers.push(allowed),
    prompt: () => { prompts++; },
  });
  assert.deepEqual(result, { handled: true, prompted: false });
  assert.equal(prevented, 1);
  assert.deepEqual(answers, [false]);
  assert.equal(prompts, 0);
});

test('only an owned main-frame certificate error reaches the trust controller', async () => {
  let prevented = 0;
  let prompts = 0;
  const result = routeCertificateError({
    owned: true,
    isMainFrame: true,
    event: { preventDefault: () => { prevented++; } },
    callback: () => {},
    prompt: () => { prompts++; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result, { handled: true, prompted: true });
  assert.equal(prevented, 1);
  assert.equal(prompts, 1);
});
