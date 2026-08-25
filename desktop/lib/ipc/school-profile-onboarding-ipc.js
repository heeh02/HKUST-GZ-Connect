'use strict';

const { allowedKeys, boundedString } = require('./ipc-guard');

function probeRequest(value) {
  const source = allowedKeys(value, ['origin', 'schoolLabel']);
  return Object.freeze({
    origin: boundedString(source.origin, {
      minLength: 1,
      maxLength: 2048,
      trim: true,
      message: 'Gateway 地址无效',
    }),
    schoolLabel: boundedString(source.schoolLabel ?? '', {
      maxLength: 96,
      trim: true,
      message: '学校名称无效',
    }),
  });
}

function confirmationRequest(value) {
  const source = allowedKeys(value, ['confirmationHandle']);
  return Object.freeze({
    confirmationHandle: boundedString(source.confirmationHandle, {
      minLength: 1,
      maxLength: 64,
      trim: true,
      message: 'Gateway 确认句柄无效',
    }),
  });
}

function registerSchoolProfileOnboardingIpc({ register, onboarding, getLocale } = {}) {
  if (typeof register !== 'function' || !onboarding ||
      typeof onboarding.list !== 'function' || typeof onboarding.probe !== 'function' ||
      typeof onboarding.confirm !== 'function' || typeof onboarding.cancel !== 'function' ||
      typeof getLocale !== 'function') {
    throw new TypeError('school Profile onboarding IPC dependencies are incomplete');
  }
  register('list-school-profiles', () => {
    try { return { ok: true, profiles: onboarding.list({ locale: getLocale() }) }; }
    catch { return { ok: false, code: 'PROFILE_LIST_FAILED', profiles: [] }; }
  });
  register('probe-custom-gateway', (_event, value) => onboarding.probe(probeRequest(value)));
  register('confirm-custom-gateway', (_event, value) => (
    onboarding.confirm(confirmationRequest(value))
  ));
  register('cancel-custom-gateway', () => ({ ok: true, cancelled: onboarding.cancel() }));
}

module.exports = {
  confirmationRequest,
  probeRequest,
  registerSchoolProfileOnboardingIpc,
};
