'use strict';

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function createControlStateSnapshot({
  getStatus,
  loadSettings,
  hasCredential,
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
    return {
      ...common(),
      settings,
      hasPassword: passwordPresent,
      loggedIn: passwordPresent && !!settings.username,
      campusResources: resources,
      ...dependencies.getProfilePresentation({
        locale: dependencies.getLocale(),
        hasCredential: passwordPresent,
        resourceCount: resources.length,
      }),
    };
  };
}

module.exports = { createControlStateSnapshot };
