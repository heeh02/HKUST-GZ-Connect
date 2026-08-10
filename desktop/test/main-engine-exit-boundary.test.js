'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('engine exit closes the browser request boundary before stdio close cleanup', () => {
  const boundaryStart = source.indexOf('function handleEngineExitBoundary(');
  const connectStart = source.indexOf('async function connectOnce(');
  assert.ok(boundaryStart >= 0 && connectStart > boundaryStart);
  const boundary = source.slice(boundaryStart, connectStart);
  assert.match(boundary, /engineSupervisor\.isCurrent\(generation\)/);
  assert.match(boundary, /connectionState\.isCurrentGeneration\(generation\)/);
  assert.match(boundary, /clearActiveProxyCredential\(generation\)/);
  assert.match(boundary, /suspendOpenBrowserPolicy\(\)/);

  const startCall = source.slice(source.indexOf('const started = engineSupervisor.start({'));
  assert.match(startCall, /onExit:\s*handleEngineExitBoundary,\s*onClose:/);
});
