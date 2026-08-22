'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(desktopRoot, '..', '.github', 'workflows', 'build.yml'), 'utf8');
const ciWorkflow = fs.readFileSync(path.join(desktopRoot, '..', '.github', 'workflows', 'ci.yml'), 'utf8');

test('cross-platform desktop checks explicitly run under Bash', () => {
  const start = workflow.indexOf('- name: Test desktop shell');
  const end = workflow.indexOf('- name: Test independent Rust engine', start);
  assert.ok(start >= 0 && end > start);
  const step = workflow.slice(start, end);
  assert.match(step, /shell:\s*bash/,
    'Windows otherwise parses process substitution and shell loops as PowerShell');
  assert.match(step, /done < <\(/, 'the step still contains Bash-only process substitution');
});

test('cloud release policy publishes only macOS DMGs, Windows EXEs, and Linux AppImages', () => {
  assert.deepEqual(
    manifest.build.mac.target,
    [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    'macOS packaging must not generate ZIP releases',
  );
  assert.match(workflow, /Build \(macOS DMG\)/, 'cloud build needs a required DMG step');
  assert.match(workflow, /desktop\/release\/\*\.dmg/, 'cloud artifacts must include DMGs');
  assert.match(workflow, /desktop\/release\/\*\.exe/, 'cloud artifacts must include Windows EXEs');
  assert.match(workflow, /desktop\/release\/\*\.AppImage/, 'cloud artifacts must include Linux AppImages');
  assert.match(
    workflow,
    /os: ubuntu-latest\s+platform: linux/,
    'the release matrix must include a Linux runner',
  );
  assert.match(workflow, /ec-engine-linux-amd64/, 'the Linux engine must use the packaged name');
  assert.match(
    workflow,
    /ec-proxy-command-linux-amd64/,
    'the Linux SSH proxy helper must use the packaged name',
  );
  assert.match(workflow, /Build \(Linux AppImage x86_64\)/, 'cloud build needs a required AppImage step');
  assert.match(workflow, /release\/linux-unpacked\/resources linux x64/, 'the unpacked Linux package must be verified');
  assert.deepEqual(
    manifest.build.linux.target,
    [{ target: 'AppImage', arch: ['x64'] }],
    'Linux packaging must produce the portable x86_64 AppImage target',
  );
  assert.doesNotMatch(
    workflow,
    /--mac zip|\.zip|\.txt|\.blockmap|SHA256SUMS/i,
    'cloud release must not publish ZIP, text, checksum, or blockmap files',
  );
  assert.match(workflow, /no macOS DMG was produced/, 'a failed DMG build must fail the cloud job');
  assert.match(workflow, /no Linux AppImage was produced/, 'a failed AppImage build must fail the cloud job');
});

test('ordinary CI gates popup MFA, exact-tree secrets and real Windows DACLs', () => {
  assert.match(ciWorkflow, /test:campus-popup-mfa-safety/u);
  assert.match(ciWorkflow, /check:secrets -- --tree "\$GITHUB_SHA"/u);
  assert.match(workflow, /check:secrets -- --tree "\$GITHUB_SHA"/u);
  assert.match(ciWorkflow, /windows-private-file:[\s\S]*runs-on: windows-latest/u);
  assert.match(ciWorkflow, /test\/windows-private-file\.test\.js/u);
});
