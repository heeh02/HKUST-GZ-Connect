'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  getLoginAccount: () => ipcRenderer.invoke('get-login-account'),
  save: (payload) => ipcRenderer.invoke('save', payload),
  connect: () => ipcRenderer.invoke('connect'),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  reconnect: () => ipcRenderer.invoke('reconnect'),
  respondAuthChallenge: (response) => ipcRenderer.invoke('respond-auth-challenge', { response }),
  resendAuthChallenge: () => ipcRenderer.invoke('resend-auth-challenge'),
  cancelAuthChallenge: () => ipcRenderer.invoke('cancel-auth-challenge'),
  logout: () => ipcRenderer.invoke('logout'),
  clearBrowserData: () => ipcRenderer.invoke('clear-browser-data'),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  openLog: () => ipcRenderer.invoke('open-log'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  openCampusBrowser: (request) => ipcRenderer.invoke('open-campus-browser', request),
  openBookmarkManager: () => ipcRenderer.invoke('open-bookmark-manager'),
  openResource: (resourceId) => ipcRenderer.invoke('open-resource', { resourceId }),
  checkUpdate: (force) => ipcRenderer.invoke('check-update', force),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  saveResource: (resource) => ipcRenderer.invoke('save-resource', resource),
  deleteResource: (id) => ipcRenderer.invoke('delete-resource', id),
  restoreBuiltinResources: () => ipcRenderer.invoke('restore-builtin-resources'),
  reorderResources: (ids) => ipcRenderer.invoke('reorder-resources', ids),
  toggleResourceFavorite: (resourceId) => ipcRenderer.invoke(
    'toggle-resource-favorite',
    { resourceId },
  ),
  listRoutingRules: () => ipcRenderer.invoke('list-routing-rules'),
  saveRoutingRule: (rule) => ipcRenderer.invoke('save-routing-rule', rule),
  deleteRoutingRule: (identity) => ipcRenderer.invoke('delete-routing-rule', identity),
  listCertificatePins: () => ipcRenderer.invoke('list-certificate-pins'),
  deleteCertificatePin: (identity) => ipcRenderer.invoke('delete-certificate-pin', identity),
  listSchoolProfiles: () => ipcRenderer.invoke('list-school-profiles'),
  probeCustomGateway: (request) => ipcRenderer.invoke('probe-custom-gateway', request),
  confirmCustomGateway: (request) => ipcRenderer.invoke('confirm-custom-gateway', request),
  cancelCustomGateway: () => ipcRenderer.invoke('cancel-custom-gateway'),
  deleteSchoolProfile: (request) => ipcRenderer.invoke('delete-school-profile', request),
  switchSchoolProfile: (request) => ipcRenderer.invoke('switch-school-profile', request),
  listIntegrations: () => ipcRenderer.invoke('list-integrations'),
  prepareIntegration: (request) => ipcRenderer.invoke('prepare-integration', request),
  confirmIntegration: (request) => ipcRenderer.invoke('confirm-integration', request),
  cancelIntegration: () => ipcRenderer.invoke('cancel-integration'),
  resize: (height) => ipcRenderer.invoke('resize', height),
  onOpenRoutingRules: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = () => cb();
    ipcRenderer.on('open-routing-rules', listener);
    return () => ipcRenderer.removeListener('open-routing-rules', listener);
  },
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onTelemetry: (cb) => ipcRenderer.on('telemetry', (_e, t) => cb(t)),
  onAuthChallenge: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, challenge) => cb(challenge);
    ipcRenderer.on('auth-challenge', listener);
    return () => ipcRenderer.removeListener('auth-challenge', listener);
  },
});
