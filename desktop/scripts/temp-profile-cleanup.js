'use strict';

const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

function validateTemporaryProfile(target, prefix) {
  if (typeof target !== 'string' || typeof prefix !== 'string' || !prefix) {
    throw new TypeError('temporary profile cleanup target is invalid');
  }
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith(`${prefix}-`)) {
    throw new Error('temporary profile cleanup target is outside the test boundary');
  }
  return resolved;
}

// Chromium can recreate Local State after Electron's `quit` event. A detached
// Node helper waits for this one test process to disappear and then removes the
// validated, direct child of os.tmpdir(). It never accepts an arbitrary tree.
function scheduleTemporaryProfileCleanup(target, prefix, {
  nodeExecutable = process.env.npm_node_execpath || 'node',
  parentPid = process.pid,
} = {}) {
  const resolved = validateTemporaryProfile(target, prefix);
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) {
    throw new TypeError('temporary profile cleanup parent PID is invalid');
  }
  const source = String.raw`
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const parentPid = Number(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    const prefix = process.argv[3];
    if (!Number.isSafeInteger(parentPid) || parentPid <= 0 ||
        path.dirname(target) !== path.resolve(os.tmpdir()) ||
        !path.basename(target).startsWith(prefix + '-')) process.exit(2);
    let attempts = 0;
    function parentAlive() {
      try { process.kill(parentPid, 0); return true; } catch { return false; }
    }
    function poll() {
      attempts += 1;
      if (parentAlive() && attempts < 600) return setTimeout(poll, 50);
      try { fs.rmSync(target, { recursive: true, force: true }); }
      catch { process.exitCode = 1; }
    }
    poll();
  `;
  const child = spawn(nodeExecutable, [
    '-e', source, String(parentPid), resolved, prefix,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

module.exports = {
  scheduleTemporaryProfileCleanup,
  validateTemporaryProfile,
};
