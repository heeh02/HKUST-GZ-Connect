'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  capabilityView,
  createCapabilityPresentation,
} = require('../renderer/capability-presentation');
const i18n = require('../renderer/i18n');

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    profileId: 'hkustgz',
    profileRevision: 1,
    accountHandle: 'must-not-project',
    layers: { provider: { secret: 'must-not-project' } },
    effective: {
      'auth.password': 'supported',
      'auth.captcha': 'unsupported',
      'auth.sms': 'unsupported',
      'auth.token': 'unsupported',
      'auth.certificate': 'unsupported',
      'auth.hid': 'unsupported',
      'auth.sso': 'unsupported',
      'auth.device': 'unsupported',
      'auth.unknown_secondary': 'unsupported',
      'resource.catalogue': 'unsupported',
      'resource.authorization_decision': 'unsupported',
      'transport.l3': 'supported',
      'transport.web_vpn': 'unavailable',
      ...overrides,
    },
  };
}

function element() {
  return {
    hidden: false, className: '', textContent: '', children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
}

test('CapabilitySnapshot alone produces one bounded user capability view', () => {
  const view = capabilityView(snapshot());
  assert.equal(view.profileId, 'hkustgz');
  assert.deepEqual(view.items, [
    { id: 'password', state: 'supported' },
    { id: 'secondary', state: 'unsupported' },
    { id: 'l3', state: 'supported' },
    { id: 'webVpn', state: 'unavailable' },
    { id: 'resources', state: 'unsupported' },
  ]);
  assert.equal(JSON.stringify(view).includes('accountHandle'), false);
  assert.equal(JSON.stringify(view).includes('layers'), false);
  assert.equal(capabilityView(null), null);
  assert.equal(capabilityView({ ...snapshot(), effective: { 'auth.password': 'invented' } }), null);
  assert.equal(capabilityView(snapshot({ 'auth.sms': 'supported' })).items[1].state, 'supported');
});

test('Renderer hides missing evidence and renders only sanitized capability rows', () => {
  const elements = new Map([
    ['capabilitySummary', element()],
    ['capabilityList', element()],
  ]);
  const feature = createCapabilityPresentation({
    document: {
      getElementById: (id) => elements.get(id),
      createElement: () => element(),
    },
    translate: (key) => key,
  });
  assert.equal(feature.render(null), false);
  assert.equal(elements.get('capabilitySummary').hidden, true);
  assert.equal(feature.render(snapshot()), true);
  assert.equal(elements.get('capabilitySummary').hidden, false);
  assert.equal(elements.get('capabilityList').children.length, 5);
  assert.equal(elements.get('capabilityList').children[0].children[0].textContent,
    'capability.item.password');
  assert.equal(elements.get('capabilityList').children[0].children[1].className,
    'capability-state supported');
  assert.equal(feature.setTranslator((key) => `translated:${key}`), true);
  assert.equal(elements.get('capabilitySummary').hidden, false,
    'a locale refresh must not discard the confirmed snapshot');
  assert.equal(elements.get('capabilityList').children[0].children[0].textContent,
    'translated:capability.item.password');
});

test('Control Tower uses the sanitized snapshot without parsing Engine strings or school identity', () => {
  const renderer = path.join(__dirname, '..', 'renderer');
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
  const feature = fs.readFileSync(path.join(renderer, 'capability-presentation.js'), 'utf8');
  const app = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(html, /id="capabilitySummary"[^>]*hidden/u);
  assert.match(html, /<script src="capability-presentation\.js"><\/script>/u);
  assert.match(app, /capabilitySnapshot: s\.capabilitySnapshot/u);
  assert.match(main, /capabilitySnapshot: activeSchoolProfile\.capabilitySnapshot\(\)/u);
  assert.doesNotMatch(feature, /schoolProfile|lastError|engine[_ -]?output|HKUST|hkust/u);
  assert.match(i18n.dictionaries.zh['capability.hint'], /不代表应用会尝试降级或绕过认证/u);
  assert.match(i18n.dictionaries.en['capability.hint'], /never downgraded or bypassed/i);
});
