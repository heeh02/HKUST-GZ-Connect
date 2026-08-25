'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  checkJavaScriptSource,
  listJavaScriptFiles,
  parseArguments,
  safeTrackedPath,
} = require('../scripts/check-javascript-syntax');

test('syntax gate argument and tracked-path schemas are exact', () => {
  assert.deepEqual(parseArguments([]), { tree: 'HEAD' });
  assert.deepEqual(parseArguments(['--tree', 'abc123']), { tree: 'abc123' });
  assert.throws(() => parseArguments(['--unknown']), /usage/u);
  assert.throws(() => parseArguments(['--tree', '--bad']), /invalid/u);
  assert.equal(safeTrackedPath('desktop/lib/example.js'), 'desktop/lib/example.js');
  for (const value of ['/absolute.js', '../escape.js', 'x/../escape.js', 'x\\bad.js',
    'x:bad.js', 'x\nbad.js']) {
    assert.throws(() => safeTrackedPath(value), /invalid/u);
  }
});

test('syntax gate fails closed on an empty or malformed Git enumeration', () => {
  const execute = () => ({ status: 0, stdout: Buffer.alloc(0) });
  assert.throws(() => listJavaScriptFiles({ repoRoot: '/repo', tree: 'HEAD', execute }),
    /zero JavaScript/u);
  assert.throws(() => listJavaScriptFiles({
    repoRoot: '/repo', tree: 'HEAD',
    execute: () => ({ status: 1, stdout: Buffer.alloc(0) }),
  }), /could not enumerate/u);
});

test('syntax gate excludes generated dependency/output trees and retains exact tracked sources', () => {
  const stdout = Buffer.from([
    'desktop/main.js',
    'desktop/lib/space name.js',
    'desktop/node_modules/ignored.js',
    'desktop/release/ignored.js',
    '',
  ].join('\0'));
  const files = listJavaScriptFiles({
    repoRoot: '/repo', tree: 'HEAD',
    execute: () => ({ status: 0, stdout }),
  });
  assert.deepEqual(files, ['desktop/lib/space name.js', 'desktop/main.js']);
});

test('syntax gate invokes the real Node parser and rejects invalid JavaScript', () => {
  assert.equal(checkJavaScriptSource(Buffer.from("'use strict';\nconst answer = 42;\n")).ok, true);
  assert.equal(checkJavaScriptSource(Buffer.alloc(0)).ok, true);
  const invalid = checkJavaScriptSource(Buffer.from("'use strict';\nconst answer =\n"));
  assert.equal(invalid.ok, false);
  assert.match(invalid.diagnostic, /SyntaxError/u);
});
