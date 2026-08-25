'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  publicSwitchCode,
  registerSchoolProfileSwitchIpc,
  switchRequest,
} = require('../../../../lib/profiles/onboarding/school-profile-switch-ipc');

test('switch IPC accepts only one bounded public Profile id', async () => {
  const handlers = new Map();
  const calls = [];
  registerSchoolProfileSwitchIpc({
    register: (channel, handler) => handlers.set(channel, handler),
    switchProfile: async (profileId) => { calls.push(profileId); return { ok: true }; },
  });
  assert.deepEqual([...handlers.keys()], ['switch-school-profile']);
  assert.deepEqual(await handlers.get('switch-school-profile')({}, {
    profileId: ' custom-example ',
  }), { ok: true });
  assert.deepEqual(calls, ['custom-example']);
  assert.throws(() => switchRequest({ profileId: 'x', profileKey: 'forbidden' }), /未知字段/u);
});

test('switch errors collapse to stable value-free codes', async () => {
  const handlers = new Map();
  registerSchoolProfileSwitchIpc({
    register: (channel, handler) => handlers.set(channel, handler),
    switchProfile: async () => {
      const error = new Error('/private/user/path');
      error.code = 'ACTIVE_CONTEXT_SWITCH_PROXY_REVOKE_FAILED';
      throw error;
    },
  });
  assert.deepEqual(await handlers.get('switch-school-profile')({}, { profileId: 'custom-a' }), {
    ok: false,
    code: 'ACTIVE_CONTEXT_SWITCH_PROXY_REVOKE_FAILED',
  });
  assert.equal(publicSwitchCode(new Error('/private/user/path')), 'PROFILE_SWITCH_FAILED');
});
