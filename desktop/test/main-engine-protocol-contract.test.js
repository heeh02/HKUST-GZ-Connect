'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('main consumes generation-bound stopped reasons at process close', () => {
  assert.match(source, /new EngineProtocolSession\(engineGeneration\)/);
  assert.match(source, /protocolSession\.accept\(event\)/);
  assert.match(source, /protocolSession\?\.stoppedReason \|\| null/);
  assert.match(source, /resolveEngineFailureKind\(\{[\s\S]*stopReason: structuredStopReason/);
  assert.match(source, /classifyEngineStopReason\(structuredStopReason, stoppedSocksPort, t\)/);
});

test('desktop requires Engine API hello and has no English stdout readiness fallback', () => {
  assert.match(source, /ENGINE_HELLO_TIMEOUT_MS/);
  assert.match(source, /protocolSession\.helloSeen/);
  assert.match(source, /structuredFatalCode = 'EVENT_OUTPUT_FAILED'/);
  assert.doesNotMatch(source, /legacyFallback|legacyStdoutTail/);
  assert.doesNotMatch(source, /SOCKS5 server listening|Client IP assigned/);
  assert.match(source, /child\.stderr\.on\('data'[\s\S]*applyHumanDiagnostic\(chunk\)/);
});

test('desktop opts into the private Control v2 stream and retains signal fallback', () => {
  assert.match(source, /new EngineControlClient\(\{ writable: child\.stdin \}\)/);
  assert.match(source, /'--control-api-v2-stdin'/);
  assert.match(source, /child\.stdin\.write\(`/);
  assert.doesNotMatch(source, /child\.stdin\.end\(/);
  assert.match(source, /case 'listener_ready':[\s\S]*startControlHandshake\(\)/);
  assert.match(source, /engineControlClient\.feed\(data\)/);
  assert.match(source, /requestGracefulStop: requestActiveEngineControlShutdown/);
});
