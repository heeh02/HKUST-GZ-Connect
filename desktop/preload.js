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
  copy: (text) => ipcRenderer.invoke('copy', text),
  openCampusBrowser: (request) => ipcRenderer.invoke('open-campus-browser', request),
  saveResource: (resource) => ipcRenderer.invoke('save-resource', resource),
  deleteResource: (id) => ipcRenderer.invoke('delete-resource', id),
  reorderResources: (ids) => ipcRenderer.invoke('reorder-resources', ids),
  resize: (height) => ipcRenderer.invoke('resize', height),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onTelemetry: (cb) => ipcRenderer.on('telemetry', (_e, t) => cb(t)),
});
