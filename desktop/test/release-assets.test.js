'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(desktopRoot, '..', '.github', 'workflows', 'build.yml'), 'utf8');

test('cloud release policy builds and publishes only macOS DMGs and Windows EXEs', () => {
  assert.deepEqual(
    manifest.build.mac.target,
    [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    'macOS packaging must not generate ZIP releases',
  );
  assert.match(workflow, /Build \(macOS DMG\)/, 'cloud build needs a required DMG step');
  assert.match(workflow, /desktop\/release\/\*\.dmg/, 'cloud artifacts must include DMGs');
  assert.match(workflow, /desktop\/release\/\*\.exe/, 'cloud artifacts must include Windows EXEs');
  assert.doesNotMatch(workflow, /--mac zip|\.zip|SHA256SUMS/i, 'cloud release must not publish ZIP or checksum text files');
  assert.match(workflow, /no macOS DMG was produced/, 'a failed DMG build must fail the cloud job');
});
