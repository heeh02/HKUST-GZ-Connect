'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const NO_VALUE = new Set(['ready', 'focus-address', 'manage-rules']);
const RESOURCE = new Set(['open-resource', 'toggle-favorite']);
const RESOURCE_ID = /^[a-z0-9-]{1,40}$/u;
const GROUP_ID = /^group_[a-z0-9_-]{12,64}$/u;

function command(name, payload = {}) {
  let message = null;
  if (NO_VALUE.has(name)) message = { command: name };
  else if (RESOURCE.has(name) && RESOURCE_ID.test(payload.resourceId)) {
    message = { command: name, resourceId: payload.resourceId };
  } else if (name === 'rename-resource' && RESOURCE_ID.test(payload.resourceId) &&
             typeof payload.name === 'string') {
    message = { command: name, resourceId: payload.resourceId, name: payload.name };
  } else if (name === 'delete-resource' && RESOURCE_ID.test(payload.resourceId)) {
    message = { command: name, resourceId: payload.resourceId };
  } else if (name === 'create-group' && typeof payload.name === 'string') {
    message = { command: name, name: payload.name };
  } else if (name === 'rename-group' && GROUP_ID.test(payload.groupId) &&
             typeof payload.name === 'string') {
    message = { command: name, groupId: payload.groupId, name: payload.name };
  } else if (name === 'delete-group' && GROUP_ID.test(payload.groupId)) {
    message = { command: name, groupId: payload.groupId };
  } else if (name === 'reorder-groups' && Array.isArray(payload.groupIds)) {
    message = { command: name, groupIds: payload.groupIds };
  } else if (name === 'move-resource' && RESOURCE_ID.test(payload.resourceId) &&
             (payload.groupId === null || GROUP_ID.test(payload.groupId)) &&
             Number.isSafeInteger(payload.index)) {
    message = {
      command: name,
      resourceId: payload.resourceId,
      groupId: payload.groupId,
      index: payload.index,
    };
  } else if (name === 'add-resources-to-group' && Array.isArray(payload.resourceIds) &&
             payload.resourceIds.length > 0 && payload.resourceIds.length <= 64 &&
             new Set(payload.resourceIds).size === payload.resourceIds.length &&
             payload.resourceIds.every((id) => RESOURCE_ID.test(id)) &&
             GROUP_ID.test(payload.groupId)) {
    message = { command: name, resourceIds: [...payload.resourceIds], groupId: payload.groupId };
  }
  if (!message) return false;
  ipcRenderer.send('campus-workspace-command', message);
  return true;
}

contextBridge.exposeInMainWorld('campusWorkspace', Object.freeze({
  command,
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('campus-workspace-state', listener);
    return () => ipcRenderer.removeListener('campus-workspace-state', listener);
  },
  onFocus(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => {
      const target = typeof value === 'string' ? value : value?.target;
      const query = typeof value?.query === 'string' ? value.query : '';
      if (!['search', 'manage'].includes(target) || query.length > 80 ||
          /[\u0000-\u001f\u007f]/u.test(query)) return;
      callback(Object.freeze({ target, query }));
    };
    ipcRenderer.on('campus-workspace-focus', listener);
    return () => ipcRenderer.removeListener('campus-workspace-focus', listener);
  },
}));
