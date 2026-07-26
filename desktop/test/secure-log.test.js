'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ensureOwnerOnly } = require('../lib/private-file');
const { appendLog, readLogTail, resetLog } = require('../lib/secure-log');

test('engine logs remain owner-only across reset and append', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX mode bits are not meaningful on Windows');
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgzconnect-log-'));
  const file = path.join(directory, 'engine.log');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  fs.writeFileSync(file, 'legacy', { mode: 0o644 });
  assert.equal(ensureOwnerOnly(file), true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  resetLog(file);
  appendLog(file, 'line one\n');
  appendLog(file, 'line two\n');

  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(readLogTail(file, 1), '');
  assert.match(readLogTail(file, 2), /line two/);
});
