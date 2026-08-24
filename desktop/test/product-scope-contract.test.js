'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, ...relativePath.split('/')), 'utf8');
}

test('2.0 keeps Web resources and external tool integration as separate product domains', () => {
  const product = read('docs/product/2.0-product-definition.md');
  const resources = read('docs/architecture/resource-domain-model.md');
  const integrations = read('docs/adr/0005-external-tool-integration-center.md');

  assert.match(product, /ordinary user[\s\S]*Campus Workspace/iu);
  assert.match(product, /External Tool Integration Center/u);
  assert.match(resources, /WebResource[\s\S]*localizedName[\s\S]*route[\s\S]*category/u);
  assert.match(resources, /Main resolves the ID in the active Profile\/Account resource store/u);
  assert.doesNotMatch(resources, /^ResourceDescriptorInternal$/mu);
  assert.doesNotMatch(resources, /^A `LaunchHandle` is:/mu);
  assert.doesNotMatch(resources, /^ResourceLaunchBroker/mu);

  assert.match(integrations, /Clash Verge Rev managed extension/u);
  assert.match(integrations, /Include ~\/\.ssh\/campus-connect\/\*\.conf/u);
  assert.match(integrations, /remote SSH service port/u);
  assert.match(integrations, /must not be uploaded, synchronized or shared/u);
  assert.match(integrations, /BEGIN CAMPUS-CONNECT MANAGED <profileId>/u);
});

test('2.0 phase order keeps multi-school before integrations and ordinary-user Web work', () => {
  const plan = read('docs/plans/2.0-preparation-execution-plan.md');
  const p6 = plan.indexOf('### 2.0-P6 — School selector, second reviewed Profile');
  const p7 = plan.indexOf('### 2.0-P7 — Shared Profile Network Rules and External Tool Integration Center');
  const p8 = plan.indexOf('### 2.0-P8 — Lightweight WebResource and ordinary-user Campus Workspace upgrade');
  assert.ok(p6 >= 0 && p7 > p6 && p8 > p7);
  assert.doesNotMatch(plan, /P8b\s+—\s+External Tool Integration Center/u);
  assert.match(plan, /P6b accepts only a bounded HTTPS domain\/port/u);
});

test('the first Beta has no built-in SSH HPC Jupyter database or forwarding workbench module', () => {
  for (const relativePath of [
    'desktop/hpc',
    'desktop/ssh-client',
    'desktop/jupyter',
    'desktop/database-launcher',
    'desktop/forwarding-workbench',
    'independent/src/hpc',
    'independent/src/ssh-client',
    'independent/src/jupyter',
    'independent/src/database-launcher',
    'independent/src/forwarding-workbench',
  ]) {
    assert.equal(fs.existsSync(path.join(root, ...relativePath.split('/'))), false, relativePath);
  }
});
