'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { findSensitivePattern } = require('../scripts/check-sensitive-patterns');

test('secret pattern gate detects representative credentials without storing fixtures verbatim', () => {
  const github = `ghp_${'a'.repeat(36)}`;
  const aws = `AKIA${'A1'.repeat(8)}`;
  const privateKey = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  assert.equal(findSensitivePattern(github), 'github-token');
  assert.equal(findSensitivePattern(aws), 'aws-access-key');
  assert.equal(findSensitivePattern(privateKey), 'private-key');
});

test('synthetic auth vocabulary and redacted placeholders are not treated as real secrets', () => {
  assert.equal(findSensitivePattern('synthetic-accepted <redacted> transaction_closed'), null);
  assert.equal(findSensitivePattern('username=<redacted> token=<redacted>'), null);
});
