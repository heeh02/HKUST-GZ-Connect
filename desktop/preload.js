'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  save: (payload) => ipcRenderer.invoke('save', payload),
  connect: () => ipcRenderer.invoke('connect'),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  reconnect: () => ipcRenderer.invoke('reconnect'),
  logout: () => ipcRenderer.invoke('logout'),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  openLog: () => ipcRenderer.invoke('open-log'),
  sshConfig: () => ipcRenderer.invoke('ssh-config'),
  copyClashNode: () => ipcRenderer.invoke('copy-clash-node'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  openCampusBrowser: (request) => ipcRenderer.invoke('open-campus-browser', request),
  checkUpdate: (force) => ipcRenderer.invoke('check-update', force),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  saveResource: (resource) => ipcRenderer.invoke('save-resource', resource),
  deleteResource: (id) => ipcRenderer.invoke('delete-resource', id),
  reorderResources: (ids) => ipcRenderer.invoke('reorder-resources', ids),
  listRoutingRules: () => ipcRenderer.invoke('list-routing-rules'),
  saveRoutingRule: (rule) => ipcRenderer.invoke('save-routing-rule', rule),
  deleteRoutingRule: (identity) => ipcRenderer.invoke('delete-routing-rule', identity),
  listCertificatePins: () => ipcRenderer.invoke('list-certificate-pins'),
  deleteCertificatePin: (identity) => ipcRenderer.invoke('delete-certificate-pin', identity),
  resize: (height) => ipcRenderer.invoke('resize', height),
  onOpenRoutingRules: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = () => cb();
    ipcRenderer.on('open-routing-rules', listener);
    return () => ipcRenderer.removeListener('open-routing-rules', listener);
  },
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onTelemetry: (cb) => ipcRenderer.on('telemetry', (_e, t) => cb(t)),
});
