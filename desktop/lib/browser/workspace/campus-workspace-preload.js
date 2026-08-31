'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const NO_VALUE = new Set(['ready', 'focus-address', 'manage-rules']);
const RESOURCE = new Set(['open-resource', 'toggle-favorite']);
const MUTATION = new Set([
  'toggle-favorite', 'rename-resource', 'delete-resource', 'create-group',
  'rename-group', 'delete-group', 'reorder-groups', 'move-resource',
  'add-resources-to-group',
]);
const RESOURCE_ID = /^[a-z0-9-]{1,40}$/u;
const GROUP_ID = /^group_[a-z0-9_-]{12,64}$/u;
const REQUEST_ID = /^workspace-[a-z0-9](?:[a-z0-9-]{0,63})$/u;
const REQUEST_TIMEOUT_MS = 15_000;
let requestSequence = 0;
const pendingRequests = new Map();

function commandMessage(name, payload = {}) {
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
  return message;
}

function requestId() {
  requestSequence = requestSequence >= Number.MAX_SAFE_INTEGER ? 1 : requestSequence + 1;
  return `workspace-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function projectResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !REQUEST_ID.test(value.requestId) || typeof value.ok !== 'boolean') return null;
  if (value.ok === true) {
    return Object.keys(value).sort().join(',') === 'ok,requestId'
      ? Object.freeze({ requestId: value.requestId, ok: true }) : null;
  }
  if (Object.keys(value).sort().join(',') !== 'code,error,ok,requestId' ||
      !['WORKSPACE_MUTATION_FAILED', 'WORKSPACE_MUTATION_STALE'].includes(value.code) ||
      typeof value.error !== 'string' || value.error.length > 300 ||
      /[\u0000-\u001f\u007f]/u.test(value.error)) return null;
  return Object.freeze({
    requestId: value.requestId,
    ok: false,
    code: value.code,
    error: value.error,
  });
}

ipcRenderer.on('campus-workspace-result', (_event, rawResult) => {
  const result = projectResult(rawResult);
  if (!result) return;
  const pending = pendingRequests.get(result.requestId);
  if (!pending) return;
  pendingRequests.delete(result.requestId);
  clearTimeout(pending.timer);
  pending.resolve(result);
});

function request(name, payload = {}) {
  const message = commandMessage(name, payload);
  if (!message || !MUTATION.has(name)) {
    return Promise.resolve(Object.freeze({
      requestId: null,
      ok: false,
      code: 'WORKSPACE_MUTATION_FAILED',
      error: '',
    }));
  }
  const identity = requestId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!pendingRequests.delete(identity)) return;
      resolve(Object.freeze({
        requestId: identity,
        ok: false,
        code: 'WORKSPACE_MUTATION_STALE',
        error: '',
      }));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(identity, { resolve, timer });
    ipcRenderer.send('campus-workspace-command', {
      requestId: identity,
      command: message,
    });
  });
}

function command(name, payload = {}) {
  const message = commandMessage(name, payload);
  if (!message) return false;
  if (MUTATION.has(name)) {
    // Retain the historical fire-and-forget return only for compatibility
    // with older local automation. The product renderer uses request() and
    // always surfaces its result.
    request(name, payload).catch(() => {});
    return true;
  }
  ipcRenderer.send('campus-workspace-command', message);
  return true;
}

contextBridge.exposeInMainWorld('campusWorkspace', Object.freeze({
  command,
  request,
  getLayout: () => ipcRenderer.invoke('get-card-board-layout'),
  commitLayout: (value) => ipcRenderer.invoke('commit-card-board-layout', value),
  resetLayout: (value) => ipcRenderer.invoke('reset-card-board-layout', value),
  onLayoutChanged(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, document) => callback(document);
    ipcRenderer.on('card-board-layout-changed', listener);
    return () => ipcRenderer.removeListener('card-board-layout-changed', listener);
  },
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
