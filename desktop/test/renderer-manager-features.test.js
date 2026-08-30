'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const managerView = require('../renderer/manager-view');
const {
  normalizeRoutingHostInput,
  routeStackSlots,
  routingGroups,
  routingRulesForView,
} = require('../renderer/routing-manager');
const { certificatePinsForView } = require('../renderer/certificate-manager');

const translate = (key) => key;

test('shared manager view escapes dynamic values and bounds operation errors', () => {
  assert.equal(managerView.escapeHtml('<script>&"'), '&lt;script&gt;&amp;&quot;');
  assert.equal(managerView.operationError({ error: ` ${'x'.repeat(400)} ` }, 'fallback').length, 300);
  assert.equal(managerView.operationError({}, 'fallback'), 'fallback');
  assert.deepEqual(managerView.collectionFromResult({ rules: [1] }, 'rules'), [1]);
  assert.equal(managerView.collectionFromResult({ rules: 'invalid' }, 'rules'), null);
});

test('routing manager normalizes host-only input and drops untrusted view fields', () => {
  assert.equal(normalizeRoutingHostInput(' Login.Example.Test. ', translate), 'login.example.test');
  for (const invalid of ['', 'https://example.test', '*.example.test', 'a..b']) {
    assert.throws(() => normalizeRoutingHostInput(invalid, translate), /routing\.invalidHost/);
  }
  assert.deepEqual(routingRulesForView([{
    host: 'x.example.test',
    includeSubdomains: false,
    route: 'direct',
    updatedAt: 10,
    token: 'forbidden',
  }]), [{
    host: 'x.example.test', includeSubdomains: false, route: 'direct', updatedAt: 10,
  }]);
  const rules = routingRulesForView([
    { host: 'campus.example.test', includeSubdomains: true, route: 'campus' },
    { host: 'direct.example.test', includeSubdomains: false, route: 'direct' },
  ]);
  assert.deepEqual(routingGroups(rules, translate).map(({ id, items }) => [id, items.length]),
    [['campus', 1], ['direct', 1]]);
  assert.equal(routeStackSlots(439), 1);
  assert.equal(routeStackSlots(440), 2);
});

test('certificate manager exposes only origin fingerprint and timestamp', () => {
  assert.deepEqual(certificatePinsForView([{
    origin: 'https://campus.example.test',
    fingerprint: 'A'.repeat(64),
    updatedAt: 20,
    certificatePem: 'forbidden',
    subject: 'forbidden',
  }]), [{
    origin: 'https://campus.example.test',
    fingerprint: 'a'.repeat(64),
    updatedAt: 20,
  }]);
});
