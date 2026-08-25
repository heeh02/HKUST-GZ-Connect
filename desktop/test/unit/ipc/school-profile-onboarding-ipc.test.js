'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  confirmationRequest,
  probeRequest,
  registerSchoolProfileOnboardingIpc,
} = require('../../../lib/ipc/school-profile-onboarding-ipc');

function fixture() {
  const handlers = new Map();
  const calls = [];
  const onboarding = {
    list: (value) => { calls.push(['list', value]); return []; },
    probe: (value) => { calls.push(['probe', value]); return { ok: true }; },
    confirm: (value) => { calls.push(['confirm', value]); return { ok: true }; },
    cancel: () => { calls.push(['cancel']); return true; },
  };
  registerSchoolProfileOnboardingIpc({
    register: (channel, handler) => handlers.set(channel, handler),
    onboarding,
    getLocale: () => 'zh',
  });
  return { calls, handlers };
}

test('onboarding IPC exposes four exact channels with bounded schemas', async () => {
  const f = fixture();
  assert.deepEqual([...f.handlers.keys()], [
    'list-school-profiles',
    'probe-custom-gateway',
    'confirm-custom-gateway',
    'cancel-custom-gateway',
  ]);
  await f.handlers.get('list-school-profiles')({});
  await f.handlers.get('probe-custom-gateway')({}, {
    origin: ' https://vpn.example.edu ',
    schoolLabel: ' Example University ',
  });
  await f.handlers.get('confirm-custom-gateway')({}, {
    confirmationHandle: ' confirmation-123 ',
  });
  assert.deepEqual(await f.handlers.get('cancel-custom-gateway')({}), {
    ok: true,
    cancelled: true,
  });
  assert.deepEqual(f.calls, [
    ['list', { locale: 'zh' }],
    ['probe', { origin: 'https://vpn.example.edu', schoolLabel: 'Example University' }],
    ['confirm', { confirmationHandle: 'confirmation-123' }],
    ['cancel'],
  ]);
});

test('onboarding IPC rejects unknown credential-like fields before Main', () => {
  assert.throws(() => probeRequest({
    origin: 'https://vpn.example.edu',
    password: 'forbidden',
  }), /未知字段/u);
  assert.throws(() => probeRequest({ origin: 'x'.repeat(2049) }), /Gateway/u);
  assert.throws(() => confirmationRequest({
    confirmationHandle: 'confirmation-1',
    token: 'forbidden',
  }), /未知字段/u);
});

test('profile list failures collapse without exposing Main error text', () => {
  const handlers = new Map();
  registerSchoolProfileOnboardingIpc({
    register: (channel, handler) => handlers.set(channel, handler),
    onboarding: {
      list: () => { throw new Error('/private/user/path'); },
      probe: () => {},
      confirm: () => {},
      cancel: () => false,
    },
    getLocale: () => 'en',
  });
  assert.deepEqual(handlers.get('list-school-profiles')({}), {
    ok: false,
    code: 'PROFILE_LIST_FAILED',
    profiles: [],
  });
});
