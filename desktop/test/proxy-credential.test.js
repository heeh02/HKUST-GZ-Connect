'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const util = require('node:util');
const { EphemeralProxyCredential, RANDOM_SECRET_BYTES } = require('../lib/proxy-credential');

function deterministicCredential() {
  let value = 0;
  return new EphemeralProxyCredential({
    randomBytes: (length) => Buffer.alloc(length, ++value),
  });
}

test('ephemeral proxy secrets are bounded, generation-scoped, and redacted', () => {
  const credential = deterministicCredential();
  assert.equal(credential.bindGeneration(7, 6180), true);
  assert.equal(credential.bindGeneration(8, 6180), false);
  const lines = credential.stdinSuffix(7).trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(Buffer.from(lines[0], 'base64url').length, RANDOM_SECRET_BYTES);
  assert.equal(Buffer.from(lines[1], 'base64url').length, RANDOM_SECRET_BYTES);
  assert.notEqual(lines[0], lines[1]);
  assert.doesNotMatch(util.inspect(credential), new RegExp(lines[0]));
  assert.doesNotMatch(JSON.stringify(credential), new RegExp(lines[1]));
  assert.throws(() => credential.stdinSuffix(8), /unavailable/);
});

test('only the exact current campus HTTP proxy challenge receives credentials', () => {
  const credential = deterministicCredential();
  credential.bindGeneration(12, 6180);
  const [expectedUser, expectedPassword] = credential.stdinSuffix(12).trimEnd().split('\n');
  const answers = [];
  const answer = (authInfo, generation = 12) => credential.answerProxyChallenge(
    authInfo,
    generation,
    (username, password) => answers.push([username, password]),
  );
  const exact = { isProxy: true, scheme: 'basic', host: '127.0.0.1', port: 6180 };
  assert.equal(answer(exact), true);
  assert.deepEqual(answers, [[expectedUser, expectedPassword]]);
  for (const rejected of [
    { ...exact, isProxy: false },
    { ...exact, scheme: 'digest' },
    { ...exact, host: 'localhost' },
    { ...exact, port: 1080 },
  ]) assert.equal(answer(rejected), false);
  assert.equal(answer(exact, 13), false);
  assert.equal(answers.length, 1);
});

test('destroy synchronously zeroes borrowed buffers and makes every use inert', () => {
  const credential = deterministicCredential();
  credential.bindGeneration(4, 6180);
  const borrowed = credential.socksAuthentication(4);
  assert.ok(borrowed.username.some((byte) => byte !== 0));
  assert.equal(credential.destroy(3), false);
  assert.equal(credential.destroy(4), true);
  assert.ok(borrowed.username.every((byte) => byte === 0));
  assert.ok(borrowed.password.every((byte) => byte === 0));
  assert.equal(credential.socksAuthentication(4), null);
  assert.equal(credential.answerProxyChallenge({}, 4, () => {}), false);
  assert.equal(credential.destroy(), false);
});

test('credential creation fails closed if entropy does not match the contract', () => {
  assert.throws(() => new EphemeralProxyCredential({ randomBytes: () => 'secret' }), /generation/);
  assert.throws(() => new EphemeralProxyCredential({
    randomBytes: () => Buffer.alloc(RANDOM_SECRET_BYTES - 1),
  }), /generation/);
});

test('a stable credential can be copied into a generation without sharing backing buffers', () => {
  const injected = {
    username: Buffer.from('A'.repeat(32)),
    password: Buffer.from('B'.repeat(32)),
  };
  const credential = new EphemeralProxyCredential({ credential: injected });
  assert.equal(credential.bindGeneration(20, 6180), true);
  injected.username.fill(0);
  injected.password.fill(0);
  assert.equal(
    credential.stdinSuffix(20),
    `${'A'.repeat(32)}\n${'B'.repeat(32)}\n`,
  );
  credential.destroy(20);
});
