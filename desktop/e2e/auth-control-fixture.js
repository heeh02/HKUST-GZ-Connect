'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  AuthChallengeCoordinator,
  EngineControlRegistry,
} = require('../lib/connection/engine/engine-control-suite');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const fixtureName = process.platform === 'win32' ? 'ec-auth-fixture.exe' : 'ec-auth-fixture';
const fixturePath = process.env.EC_AUTH_FIXTURE || path.join(
  repositoryRoot,
  'independent',
  'target',
  'debug',
  fixtureName,
);
let activeChild = null;

function nextPublished(published, startIndex) {
  const deadline = Date.now() + 3_000;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (published.length > startIndex) resolve(published.at(-1));
      else if (Date.now() >= deadline) reject(new Error('auth challenge event timed out'));
      else setImmediate(poll);
    };
    poll();
  });
}

async function main() {
  assert.ok(fs.existsSync(fixturePath), `synthetic auth fixture is missing: ${fixturePath}`);
  const child = spawn(fixturePath, ['--generation', '9'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  activeChild = child;
  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`fixture exit ${code}`))));
  });
  let stdout = '';
  let stderr = '';
  const published = [];
  const contextToken = Object.freeze({
    profileId: 'synthetic-profile',
    profileRevision: 1,
    accountHandle: `account-${'a'.repeat(36)}`,
    activeContextEpoch: 1,
    connectionIntent: 1,
    engineGeneration: 9,
  });
  const coordinator = new AuthChallengeCoordinator({
    publish: (challenge) => published.push(challenge),
    isContextCurrent: (candidate) => candidate === contextToken,
  });
  const registry = new EngineControlRegistry({ authChallenges: coordinator });
  const controls = registry.bind(9, child.stdin, contextToken);
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
    controls.feed(chunk);
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

  const timeout = setTimeout(() => {
    child.kill();
  }, 5_000);
  timeout.unref?.();
  await controls.handshake();
  if (!published.length) await nextPublished(published, 0);
  const first = published.at(-1);
  assert.equal(first.kind, 'otp');
  assert.equal(first.attemptsRemaining, 3);
  for (const forbidden of ['transactionId', 'challengeEpoch', 'generation']) {
    assert.equal(Object.hasOwn(first, forbidden), false);
  }

  let version = published.length;
  const wrong = { response: 'synthetic-wrong' };
  await coordinator.respond(wrong);
  assert.equal(wrong.response, '');
  if (published.length === version) await nextPublished(published, version);
  assert.equal(published.at(-1).attemptsRemaining, 2);

  version = published.length;
  await coordinator.resend();
  if (published.length === version) await nextPublished(published, version);
  assert.equal(published.at(-1).resendAvailable, true);

  const accepted = { response: 'synthetic-accepted' };
  await coordinator.respond(accepted);
  assert.equal(accepted.response, '');
  await exitPromise;
  activeChild = null;
  clearTimeout(timeout);
  registry.clear(9);
  assert.equal(published.at(-1), null);
  assert.equal(stderr, '');
  for (const forbidden of ['synthetic-wrong', 'synthetic-accepted', '"response"']) {
    assert.equal(stdout.includes(forbidden), false);
  }
  process.stdout.write('auth control fixture e2e: PASS\n');
}

main().catch((error) => {
  try { activeChild?.kill(); } catch {}
  activeChild = null;
  process.stderr.write(`auth control fixture e2e: FAIL (${error.message})\n`);
  process.exitCode = 1;
});
