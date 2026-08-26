'use strict';

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function maskedAccountLabel(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return '';
  const visible = text.slice(0, Math.min(3, text.length));
  return `${visible}${'*'.repeat(Math.max(3, Math.min(8, text.length - visible.length)))}`;
}

function createControlStateSnapshot({
  getStatus,
  loadSettings,
  hasCredential,
  hasAccountIdentity,
  getPacUrl,
  getLocale,
  platform,
  getVersion,
  getUpdate,
  getResources,
  getFallbackResources,
  getProfilePresentation,
  getAuthChallenge,
  getCapabilitySnapshot,
} = {}) {
  const dependencies = {
    getStatus: requiredFunction(getStatus, 'getStatus'),
    loadSettings: requiredFunction(loadSettings, 'loadSettings'),
    hasCredential: requiredFunction(hasCredential, 'hasCredential'),
    hasAccountIdentity: requiredFunction(hasAccountIdentity, 'hasAccountIdentity'),
    getPacUrl: requiredFunction(getPacUrl, 'getPacUrl'),
    getLocale: requiredFunction(getLocale, 'getLocale'),
    getVersion: requiredFunction(getVersion, 'getVersion'),
    getUpdate: requiredFunction(getUpdate, 'getUpdate'),
    getResources: requiredFunction(getResources, 'getResources'),
    getFallbackResources: requiredFunction(getFallbackResources, 'getFallbackResources'),
    getProfilePresentation: requiredFunction(getProfilePresentation, 'getProfilePresentation'),
    getAuthChallenge: requiredFunction(getAuthChallenge, 'getAuthChallenge'),
    getCapabilitySnapshot: requiredFunction(getCapabilitySnapshot, 'getCapabilitySnapshot'),
  };
  if (typeof platform !== 'string' || !platform) throw new TypeError('platform is required');

  const common = () => ({
    ...dependencies.getStatus(),
    pacUrl: dependencies.getPacUrl(),
    locale: dependencies.getLocale(),
    platform,
    version: dependencies.getVersion(),
    update: dependencies.getUpdate(),
    authChallenge: dependencies.getAuthChallenge(),
    capabilitySnapshot: dependencies.getCapabilitySnapshot(),
  });

  return function controlStateSnapshot() {
    let settings;
    try {
      settings = dependencies.loadSettings();
    } catch {
      const resources = dependencies.getFallbackResources();
      return {
        ...common(),
        settings: null,
        hasPassword: false,
        loggedIn: false,
        campusResources: resources,
        ...dependencies.getProfilePresentation({ locale: dependencies.getLocale() }),
      };
    }
    const passwordPresent = dependencies.hasCredential();
    const resources = dependencies.getResources(settings);
    const publicSettings = Object.freeze({
      ...settings,
      username: maskedAccountLabel(settings.username),
    });
    const favoriteCount = resources.filter(({ favorite }) => favorite === true).length;
    const recentCount = resources.filter(({ lastOpenedAt }) => Number.isSafeInteger(lastOpenedAt)).length;
    return {
      ...common(),
      settings: publicSettings,
      hasPassword: passwordPresent,
      loggedIn: passwordPresent && dependencies.hasAccountIdentity(settings),
      campusResources: resources,
      ...dependencies.getProfilePresentation({
        locale: dependencies.getLocale(),
        hasCredential: passwordPresent,
        resourceCount: resources.length,
        favoriteCount,
        recentCount,
      }),
    };
  };
}

module.exports = { createControlStateSnapshot, maskedAccountLabel };
