'use strict';

const { contextBridge } = require('electron');

let resources = Array.from({ length: 18 }, (_, index) => ({
  id: `fixture-${index}`,
  name: `测试网站 ${index + 1}`,
  url: `https://fixture-${index}.example.edu/`,
  description: '用于布局回归测试',
  route: index % 2 ? 'direct' : 'campus',
  category: 'custom',
  keywords: [],
  favorite: false,
  lastOpenedAt: null,
  builtin: false,
}));
let lastOpenRequest = null;
let nextCustomId = 1;
let pendingIntegration = null;
let managedIntegrationState = 'not-installed';

const integrationAdapters = [
  'clash_yaml', 'mihomo_yaml', 'clash_verge_rev_managed',
  'openssh_proxy_command', 'pac', 'manual_export',
];

function integrationViews() {
  return integrationAdapters.map((adapterId) => ({
    schemaVersion: 1,
    adapterId,
    compatibilityState: 'supported',
    bindingState: adapterId === 'clash_verge_rev_managed'
      ? managedIntegrationState : 'not-installed',
    supportedActions: adapterId === 'clash_verge_rev_managed'
      ? (managedIntegrationState === 'not-installed' ? ['install'] : ['update', 'remove'])
      : ['copy', 'save'],
    updatedAt: managedIntegrationState === 'current' ? 1_800_000_000_000 : null,
  }));
}

function normalizeFixtureUrl(value) {
  const source = String(value || '').trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(source) ? source : `https://${source}`;
  return new URL(candidate).href;
}

const state = {
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
  getLogs: async () => '',
  openLog: async () => ({ ok: true }),
  sshConfig: async () => '',
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
  deleteResource: async () => ({ ok: true, resources }),
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
        changes: { create: action === 'install' ? 1 : 0, replace: 0, remove: 0, unchanged: 0 },
        byteLength: 512,
        ruleCount: 2,
        containsLocalProxyCredential: true,
        warningCodes: ['INTEGRATION_LOCAL_PROXY_CREDENTIAL'],
      },
    };
  },
  confirmIntegration: async ({ confirmationHandle }) => {
    if (!pendingIntegration || pendingIntegration.confirmationHandle !== confirmationHandle) {
      return { ok: false, code: 'INTEGRATION_TARGET_CHANGED' };
    }
    if (pendingIntegration.adapterId === 'clash_verge_rev_managed') {
      managedIntegrationState = pendingIntegration.action === 'remove' ? 'not-installed' : 'current';
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
