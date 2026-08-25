'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeOpenRequest,
  requiresCampusTunnel,
} = require('../../../../lib/browser/resources/campus-open-policy');

test('open requests fail safe to Campus unless Profile authority supplies an explicit route', () => {
  assert.deepEqual(normalizeOpenRequest('outlook.office.com/owa/'), {
    url: 'https://outlook.office.com/owa/',
    route: 'campus',
  });
  assert.deepEqual(normalizeOpenRequest({
    url: 'https://outlook.office.com/owa/',
    route: 'direct',
  }), {
    url: 'https://outlook.office.com/owa/',
    route: 'direct',
  });
  assert.deepEqual(normalizeOpenRequest({ url: 'https://outlook.office.com/owa/', route: 'campus' }), {
    url: 'https://outlook.office.com/owa/',
    route: 'campus',
  });
});

test('only campus requests require the engine', () => {
  assert.equal(requiresCampusTunnel('campus'), true);
  assert.equal(requiresCampusTunnel('direct'), false);
});
