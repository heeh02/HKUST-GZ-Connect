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

function projectResourceGroups(value) {
  if (!Array.isArray(value) || value.length > 16) return Object.freeze([]);
  const seen = new Set();
  const groups = [];
  for (const group of value) {
    if (!group || typeof group !== 'object' || Array.isArray(group) ||
        typeof group.id !== 'string' || !/^group_[a-z0-9_-]{12,64}$/u.test(group.id) ||
        seen.has(group.id) || typeof group.name !== 'string' || !group.name.trim() ||
        group.name.length > 30 || /[\u0000-\u001f\u007f<>]/u.test(group.name) ||
        !Array.isArray(group.resourceIds) || group.resourceIds.length > 64 ||
        new Set(group.resourceIds).size !== group.resourceIds.length ||
        group.resourceIds.some((id) => typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/u.test(id))) {
      return Object.freeze([]);
    }
    seen.add(group.id);
    groups.push(Object.freeze({
      id: group.id,
      name: group.name.trim(),
      resourceIds: Object.freeze([...group.resourceIds]),
    }));
  }
  return Object.freeze(groups);
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
  getResourceGroups,
  getFallbackResources,
  getProfilePresentation,
  getAuthChallenge,
  getNetworkEnvironment,
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
    getResourceGroups: requiredFunction(getResourceGroups, 'getResourceGroups'),
    getFallbackResources: requiredFunction(getFallbackResources, 'getFallbackResources'),
    getProfilePresentation: requiredFunction(getProfilePresentation, 'getProfilePresentation'),
    getAuthChallenge: requiredFunction(getAuthChallenge, 'getAuthChallenge'),
    getNetworkEnvironment: requiredFunction(getNetworkEnvironment, 'getNetworkEnvironment'),
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
    networkEnvironment: dependencies.getNetworkEnvironment(),
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
        resourceGroups: [],
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
      resourceGroups: projectResourceGroups(dependencies.getResourceGroups()),
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

module.exports = { createControlStateSnapshot, maskedAccountLabel, projectResourceGroups };
