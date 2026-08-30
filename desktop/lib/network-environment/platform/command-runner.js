'use strict';

const { execFileSync } = require('node:child_process');

function createCommandRunner({ exec = execFileSync } = {}) {
  return function run(command, args = [], { timeout = 1200, maxBuffer = 256 * 1024 } = {}) {
    try {
      return exec(command, args, { encoding: 'utf8', timeout, maxBuffer,
        stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    } catch { return ''; }
  };
}

module.exports = { createCommandRunner };
