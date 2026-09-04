'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  actionPinErrors,
  governanceErrors,
  moduleMapErrors,
  relativeMarkdownTargets,
} = require('../../../.github/scripts/check-repository-governance');

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');

test('current Git index satisfies repository governance', () => {
  assert.deepEqual(governanceErrors(repositoryRoot), []);
});

test('workflow actions require immutable full commit SHAs', () => {
  assert.deepEqual(actionPinErrors(
    'steps:\n  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n',
    'fixture.yml',
  ), []);
  assert.deepEqual(actionPinErrors(
    'steps:\n  - uses: actions/checkout@v4\n',
    'fixture.yml',
  ), ['fixture.yml:2 action is not pinned to a full commit SHA: actions/checkout@v4']);
  assert.deepEqual(actionPinErrors('on:\n  pull_request_target:\n', 'fixture.yml'), [
    'fixture.yml uses forbidden pull_request_target',
  ]);
});

test('module map requires unique, complete module records', () => {
  const record = (id) => `  - id: ${id}\n    paths: []\n    publicEntrypoints: []\n    allowedDependencies: []\n    risk: low\n    requiredChecks: []\n`;
  const complete = `modules:\n${Array.from({ length: 10 }, (_, index) => record(`m-${index}`)).join('')}`;
  assert.deepEqual(moduleMapErrors(complete), []);
  assert.ok(moduleMapErrors(`modules:\n${record('same')}${record('same')}`).includes(
    'duplicate module id: same',
  ));
});

test('Markdown governance checks only repository-relative targets', () => {
  assert.deepEqual(relativeMarkdownTargets(
    '[local](../docs/README.md) [anchor](#title) [web](https://example.com) [root](/SECURITY.md)',
  ), [{ target: '../docs/README.md', invalidEncoding: false }]);
  assert.deepEqual(relativeMarkdownTargets('[bad](broken%ZZ.md)'), [
    { target: 'broken%ZZ.md', invalidEncoding: true },
  ]);
});
