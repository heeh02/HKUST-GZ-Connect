'use strict';

const fs = require('fs');
const { ensureOwnerOnly } = require('./private-file');

function resetLog(file) {
  fs.writeFileSync(file, '', { mode: 0o600 });
  ensureOwnerOnly(file);
}

function appendLog(file, text) {
  const descriptor = fs.openSync(file, 'a', 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeSync(descriptor, String(text));
  } finally {
    fs.closeSync(descriptor);
  }
}

function readLogTail(file, maxLines = 300) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

module.exports = { appendLog, readLogTail, resetLog };
