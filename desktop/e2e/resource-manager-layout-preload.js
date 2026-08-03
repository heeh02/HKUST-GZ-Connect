'use strict';

const { contextBridge } = require('electron');

const resources = Array.from({ length: 18 }, (_, index) => ({
  id: `fixture-${index}`,
  name: `测试网站 ${index + 1}`,
  url: `https://fixture-${index}.example.edu/`,
  description: '用于布局回归测试',
  route: index % 2 ? 'direct' : 'campus',
  builtin: false,
}));

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
  openCampusBrowser: async () => ({ ok: true }),
  saveResource: async () => ({ ok: true, resources }),
  deleteResource: async () => ({ ok: true, resources }),
  reorderResources: async () => ({ ok: true, resources }),
  resize: async () => ({ ok: true }),
  onStatus: () => {},
  onTelemetry: () => {},
});
