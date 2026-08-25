'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  inspectManagedBlock,
  managedBlockMatches,
  removeManagedBlock,
  upsertManagedBlock,
} = require('../../lib/integrations/managed-text-block');

const options = { commentPrefix: '#', blockId: 'openssh-include' };

test('managed block append update and remove preserve every unrelated byte and newline style', () => {
  const original = 'Host existing\r\n  User student\r\n';
  const installed = upsertManagedBlock(original, 'Include ~/.ssh/campus-connect/*.conf', options);
  assert.match(installed, /Host existing\r\n  User student\r\n\r\n# BEGIN/u);
  assert.equal(inspectManagedBlock(installed, options).newline, '\r\n');
  assert.equal(managedBlockMatches(
    installed, 'Include ~/.ssh/campus-connect/*.conf', options,
  ), true);

  const updated = upsertManagedBlock(installed, 'Include ~/.ssh/campus-connect/current/*.conf', options);
  assert.match(updated, /Include ~\/\.ssh\/campus-connect\/current\/\*\.conf/u);
  assert.doesNotMatch(updated, /Include ~\/\.ssh\/campus-connect\/\*\.conf/u);
  assert.equal(removeManagedBlock(updated, options), original);
});

test('marker collisions malformed ranges and injected marker content fail closed', () => {
  assert.throws(() => inspectManagedBlock(
    '# BEGIN CAMPUS-CONNECT MANAGED openssh-include\nmissing end\n', options,
  ), /markers conflict/u);
  assert.throws(() => inspectManagedBlock([
    '# BEGIN CAMPUS-CONNECT MANAGED openssh-include',
    '# END CAMPUS-CONNECT MANAGED openssh-include',
    '# BEGIN CAMPUS-CONNECT MANAGED openssh-include',
    '# END CAMPUS-CONNECT MANAGED openssh-include',
  ].join('\n'), options), /markers conflict/u);
  assert.throws(() => upsertManagedBlock('', [
    'safe', '# BEGIN CAMPUS-CONNECT MANAGED other-block',
  ].join('\n'), options), /contains a marker/u);
});

test('JavaScript comments use an independent exact block identity', () => {
  const js = upsertManagedBlock(
    'function main(config) { return config; }\n',
    'main = function(config) { return config; };',
    { commentPrefix: '//', blockId: 'clash-verge-rev' },
  );
  assert.match(js, /\/\/ BEGIN CAMPUS-CONNECT MANAGED clash-verge-rev/u);
  assert.equal(managedBlockMatches(
    js,
    'main = function(config) { return config; };',
    { commentPrefix: '//', blockId: 'clash-verge-rev' },
  ), true);
});
