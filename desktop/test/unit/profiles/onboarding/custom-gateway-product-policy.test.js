'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  customGatewayProductAvailability,
} = require('../../../../lib/app/startup/multi-school-startup-runtime');

test('other-school onboarding is available by default in packaged and development products', () => {
  assert.equal(customGatewayProductAvailability({ environment: {} }), true);
  assert.equal(customGatewayProductAvailability({
    environment: { HKUSTGZ_ENABLE_CUSTOM_GATEWAY: '0' },
  }), true);
});

test('an explicit emergency kill switch can hide new Custom Gateway onboarding', () => {
  assert.equal(customGatewayProductAvailability({
    environment: { HKUSTGZ_DISABLE_CUSTOM_GATEWAY: '1' },
  }), false);
  assert.equal(customGatewayProductAvailability({
    environment: { HKUSTGZ_DISABLE_CUSTOM_GATEWAY: 'true' },
  }), true);
});
