'use strict';

const { allowedKeys, boundedString } = require('./ipc-guard');

function switchRequest(value) {
  const source = allowedKeys(value, ['profileId']);
  return Object.freeze({
    profileId: boundedString(source.profileId, {
      minLength: 1,
      maxLength: 80,
      trim: true,
      message: '学校 Profile 无效',
    }),
  });
}

function publicSwitchCode(error) {
  const code = String(error?.code || '');
  if (/^ACTIVE_CONTEXT_SWITCH_[A-Z_]{1,64}$/u.test(code)) return code;
  if (/already active/u.test(String(error?.message || ''))) return 'PROFILE_ALREADY_ACTIVE';
  if (/unavailable/u.test(String(error?.message || ''))) return 'PROFILE_UNAVAILABLE';
  return 'PROFILE_SWITCH_FAILED';
}

function registerSchoolProfileSwitchIpc({ register, switchProfile } = {}) {
  if (typeof register !== 'function' || typeof switchProfile !== 'function') {
    throw new TypeError('school Profile switch IPC dependencies are incomplete');
  }
  register('switch-school-profile', async (_event, value) => {
    const request = switchRequest(value);
    try { return await switchProfile(request.profileId); }
    catch (error) { return { ok: false, code: publicSwitchCode(error) }; }
  });
}

module.exports = {
  publicSwitchCode,
  registerSchoolProfileSwitchIpc,
  switchRequest,
};
