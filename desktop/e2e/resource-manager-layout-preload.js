'use strict';

const { contextBridge } = require('electron');
const fixtureLocale = process.env.HKUSTGZ_E2E_LOCALE === 'en' ? 'en' : 'zh';

const builtinResource = Object.freeze({
  id: 'builtin-home',
  name: fixtureLocale === 'en' ? 'Built-in School Home' : '内置学校主页',
  url: 'https://builtin.example.edu/',
  description: fixtureLocale === 'en' ? 'Built-in removal and restore fixture' : '用于内置网站删除与恢复回归',
  route: 'campus',
  category: 'campus-service',
  keywords: [],
  favorite: false,
  lastOpenedAt: null,
  builtin: true,
});
let resources = [builtinResource, ...Array.from({ length: 18 }, (_, index) => ({
  id: `fixture-${index}`,
  name: fixtureLocale === 'en' ? `Test Site ${index + 1}` : `测试网站 ${index + 1}`,
  url: `https://fixture-${index}.example.edu/`,
  description: fixtureLocale === 'en' ? 'Layout regression fixture' : '用于布局回归测试',
  route: index % 2 ? 'direct' : 'campus',
  category: 'custom',
  keywords: [],
  favorite: false,
  lastOpenedAt: null,
  builtin: false,
}))];
let lastOpenRequest = null;
let nextCustomId = 1;
let pendingIntegration = null;

const integrationAdapters = [
  'clash_yaml', 'mihomo_yaml', 'vscode_remote_ssh',
];

function integrationViews() {
  return integrationAdapters.map((adapterId) => ({
    schemaVersion: 1,
    adapterId,
    compatibilityState: 'supported',
    bindingState: 'not-installed',
    supportedActions: adapterId === 'vscode_remote_ssh' ? ['copy'] : ['copy', 'save'],
    updatedAt: null,
  }));
}

function normalizeFixtureUrl(value) {
  const source = String(value || '').trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(source) ? source : `https://${source}`;
  return new URL(candidate).href;
}

const state = {
  locale: fixtureLocale,
  loggedIn: true,
  settings: {
    port: 1080,
    autoReconnect: true,
    maxAttempts: 3,
    closeAction: 'ask',
  },
  campusResources: resources,
  connected: false,
  connecting: false,
  clientIp: null,
  lastError: null,
  version: 'test',
  pacUrl: '',
};

contextBridge.exposeInMainWorld('api', {
  getState: async () => state,
  save: async () => ({ ok: true }),
  connect: async () => ({ ok: true }),
  disconnect: async () => ({ ok: true }),
  reconnect: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
  clearBrowserData: async () => ({ ok: true }),
  getLogs: async () => '',
  openLog: async () => ({ ok: true }),
  copy: async () => ({ ok: true }),
  openCampusBrowser: async (request) => {
    lastOpenRequest = request;
    return { ok: true };
  },
  openResource: async (resourceId) => {
    lastOpenRequest = { resourceId };
    resources = resources.map((resource) => (
      resource.id === resourceId ? { ...resource, lastOpenedAt: Date.now() } : resource
    ));
    return { ok: true, resourceId, resources };
  },
  saveResource: async (resource) => {
    const saved = {
      ...resource,
      id: resource.id || `custom-test-${nextCustomId++}`,
      url: normalizeFixtureUrl(resource.url),
      route: resource.route || 'campus',
      builtin: false,
      category: 'custom',
      keywords: [],
      favorite: false,
      lastOpenedAt: null,
    };
    resources = [...resources.filter((item) => item.id !== saved.id), saved];
    return { ok: true, resource: saved, resources };
  },
  deleteResource: async (resourceId) => {
    resources = resources.filter((resource) => resource.id !== resourceId);
    return { ok: true, resources };
  },
  restoreBuiltinResources: async () => {
    if (!resources.some((resource) => resource.id === builtinResource.id)) {
      resources = [builtinResource, ...resources];
    }
    return { ok: true, resources };
  },
  reorderResources: async () => ({ ok: true, resources }),
  toggleResourceFavorite: async (resourceId) => {
    resources = resources.map((resource) => (
      resource.id === resourceId ? { ...resource, favorite: !resource.favorite } : resource
    ));
    return { ok: true, resources };
  },
  listIntegrations: async () => ({ ok: true, integrations: integrationViews() }),
  prepareIntegration: async ({ adapterId, action }) => {
    if (!integrationAdapters.includes(adapterId)) {
      return { ok: false, code: 'INTEGRATION_ADAPTER_UNAVAILABLE' };
    }
    const confirmationHandle = `export-${'ab'.repeat(16)}`;
    pendingIntegration = { adapterId, action, confirmationHandle };
    return {
      ok: true,
      preview: {
        schemaVersion: 1,
        adapterId,
        action,
        confirmationHandle,
        expiresAt: Date.now() + 10_000,
        changes: { create: 0, replace: 0, remove: 0, unchanged: 0 },
        byteLength: 512,
        ruleCount: 2,
        containsLocalProxyCredential: true,
        warningCodes: ['INTEGRATION_LOCAL_CREDENTIAL_PRIVATE'],
      },
    };
  },
  confirmIntegration: async ({ confirmationHandle }) => {
    if (!pendingIntegration || pendingIntegration.confirmationHandle !== confirmationHandle) {
      return { ok: false, code: 'INTEGRATION_TARGET_CHANGED' };
    }
    pendingIntegration = null;
    return { ok: true };
  },
  cancelIntegration: async () => {
    pendingIntegration = null;
    return { ok: true, cancelled: true };
  },
  resize: async () => ({ ok: true }),
  onStatus: () => {},
  onTelemetry: () => {},
  testState: () => ({ lastOpenRequest }),
});
