'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const connectStart = source.indexOf('async function connectOnce(');
const connectEnd = source.indexOf('\nfunction ensureEngineStopped()', connectStart);
const connectOnce = source.slice(connectStart, connectEnd);

test('strict and compatibility generations share one stable credential with distinct policies', () => {
  assert.match(source, /const PROXY_CREDENTIAL = runtimeStoragePaths\.proxyCredential/);
  assert.match(connectOnce, /proxyCredential = generationProxyCredential\(Number\(s\.port\)\);\s*proxyCredentialMode = 'required'/);
  assert.match(connectOnce, /stableProxyCredential \|\| fs\.existsSync\(PROXY_CREDENTIAL\)[\s\S]*proxyCredentialMode = 'optional'/);
  assert.match(connectOnce, /proxyCredentialMode === 'required'[^\n]+--socks-auth-stdin/);
  assert.match(connectOnce, /proxyCredentialMode === 'optional'[^\n]+--socks-auth-optional-stdin/);
  assert.match(
    connectOnce,
    /\$\{engineConfigBinding\.stdinFrame\}\\n\$\{username\}\\n\$\{pw\}\\n\$\{proxyCredentialLines\}/,
  );
  assert.match(connectOnce, /'--control-api-v2-stdin'/);
});

test('Clash credentials stay in main and activate optional auth for an existing listener', () => {
  const start = source.indexOf('copyClashNode: async () =>');
  const end = source.indexOf('getLogs: async () =>', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /ensureExternalProxyAccess\(Number\(settings\.port\)\)/);
  assert.match(handler, /engineSupervisor\.hasActive[\s\S]+await reconnect\(\)/);
  assert.match(handler, /clipboard\.writeText\(buildClashProxyYaml/);
  assert.match(handler, /return \{ ok: true \}/);
  assert.doesNotMatch(handler, /return[^\n]+(?:username|password)/i);
});

test('SSH config contains a helper and credential-file path while sidecar follows lifecycle', () => {
  assert.match(source, /buildSshProxyCommand\(\{\s*helperPath: proxyHelperPath\(\),\s*credentialFile: PROXY_HELPER_CREDENTIAL/);
  const disconnectStart = source.indexOf('async function disconnect(');
  const reconnectStart = source.indexOf('\nfunction waitForConnected(', disconnectStart);
  assert.match(source.slice(disconnectStart, reconnectStart), /removeExternalProxySidecar\(\)/);
  const exitStart = source.indexOf('function handleEngineExitBoundary');
  const exitEnd = source.indexOf('\nasync function connectOnce(', exitStart);
  assert.match(source.slice(exitStart, exitEnd), /removeExternalProxySidecar\(\)/);
  assert.match(source, /stableProxyCredential\?\.destroy\(\)/);
});

test('Profile switch revokes in-memory and sidecar access before the next Account activates', () => {
  assert.match(source, /function revokeExternalProxyAccess\(\) \{ clearActiveProxyCredential\(\);/u);
  assert.match(source, /stableProxyCredential\?\.destroy\(\); stableProxyCredential = null;/u);
  assert.match(source, /revokeProxyAccess: revokeExternalProxyAccess/u);
});
