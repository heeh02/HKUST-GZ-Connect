'use strict';

const { execFile } = require('node:child_process');

function createCommandRunner({ exec = execFile } = {}) {
  return function run(command, args = [], { timeout = 1200, maxBuffer = 256 * 1024 } = {}) {
    return new Promise((resolve) => {
      try {
        exec(command, args, {
          encoding: 'utf8', timeout, maxBuffer,
          windowsHide: true,
        }, (error, stdout) => resolve(error ? '' : String(stdout || '')));
      } catch {
        resolve('');
      }
    });
  };
}

module.exports = { createCommandRunner };
