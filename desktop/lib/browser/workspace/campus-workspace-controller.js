'use strict';

const RESOURCE_ID = /^[a-z0-9-]{1,40}$/u;
const GROUP_ID = /^group_[a-z0-9_-]{12,64}$/u;
const GROUP_NAME_MAX = 30;
const RESOURCE_CATEGORIES = new Set([
  'gateway', 'newcomer', 'courses', 'labs', 'student-finance', 'expenses',
  'documents', 'tools', 'staff',
  'getting-started', 'learning', 'research', 'finance', 'career', 'campus-life',
  'applications', 'services', 'common', 'academic', 'campus-service', 'custom',
]);
const COMMANDS = new Set([
  'ready',
  'open-resource',
  'toggle-favorite',
  'rename-resource',
  'delete-resource',
  'manage-rules',
  'create-group',
  'rename-group',
  'delete-group',
  'reorder-groups',
  'move-resource',
  'add-resources-to-group',
]);

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype ? value : null;
}

function normalizeWorkspaceCommand(value) {
  const source = plainObject(value);
  if (!source || !COMMANDS.has(source.command)) return null;
  const keys = Object.keys(source).sort();
  if (source.command === 'ready' || source.command === 'manage-rules') {
    return keys.length === 1 ? Object.freeze({ command: source.command }) : null;
  }
  if (source.command === 'open-resource' || source.command === 'toggle-favorite') {
    return keys.length === 2 && RESOURCE_ID.test(source.resourceId)
      ? Object.freeze({ command: source.command, resourceId: source.resourceId }) : null;
  }
  if (source.command === 'rename-resource') {
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    return keys.length === 3 && RESOURCE_ID.test(source.resourceId) && name &&
      name.length <= 40 && !/[\u0000-\u001f\u007f<>]/u.test(name)
      ? Object.freeze({ command: source.command, resourceId: source.resourceId, name }) : null;
  }
  if (source.command === 'delete-resource') {
    return keys.length === 2 && RESOURCE_ID.test(source.resourceId)
      ? Object.freeze({ command: source.command, resourceId: source.resourceId }) : null;
  }
  if (source.command === 'create-group') {
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    return keys.length === 2 && name && name.length <= GROUP_NAME_MAX &&
      !/[\u0000-\u001f\u007f<>]/u.test(name)
      ? Object.freeze({ command: source.command, name }) : null;
  }
  if (source.command === 'rename-group') {
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    return keys.length === 3 && GROUP_ID.test(source.groupId) && name &&
      name.length <= GROUP_NAME_MAX && !/[\u0000-\u001f\u007f<>]/u.test(name)
      ? Object.freeze({ command: source.command, groupId: source.groupId, name }) : null;
  }
  if (source.command === 'delete-group') {
    return keys.length === 2 && GROUP_ID.test(source.groupId)
      ? Object.freeze({ command: source.command, groupId: source.groupId }) : null;
  }
  if (source.command === 'reorder-groups') {
    if (keys.length !== 2 || !Array.isArray(source.groupIds) || source.groupIds.length > 16 ||
        new Set(source.groupIds).size !== source.groupIds.length ||
        source.groupIds.some((id) => !GROUP_ID.test(id))) return null;
    return Object.freeze({ command: source.command, groupIds: Object.freeze([...source.groupIds]) });
  }
  if (source.command === 'move-resource') {
    const groupId = source.groupId === null ? null : source.groupId;
    return keys.length === 4 && RESOURCE_ID.test(source.resourceId) &&
      (groupId === null || GROUP_ID.test(groupId)) &&
      Number.isSafeInteger(source.index) && source.index >= 0 && source.index <= 64
      ? Object.freeze({
        command: source.command,
        resourceId: source.resourceId,
        groupId,
        index: source.index,
      }) : null;
  }
  if (source.command === 'add-resources-to-group') {
    return keys.length === 3 && GROUP_ID.test(source.groupId) &&
      Array.isArray(source.resourceIds) && source.resourceIds.length > 0 &&
      source.resourceIds.length <= 64 && new Set(source.resourceIds).size === source.resourceIds.length &&
      source.resourceIds.every((id) => RESOURCE_ID.test(id))
      ? Object.freeze({ command: source.command, groupId: source.groupId,
        resourceIds: Object.freeze([...source.resourceIds]) }) : null;
  }
  return null;
}

function projectWorkspaceResources(value) {
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError('Campus Workspace resources are invalid');
  }
  return Object.freeze(value.map((resource) => {
    const keywords = resource?.keywords == null ? [] : resource.keywords;
    if (!resource || typeof resource !== 'object' ||
        !RESOURCE_ID.test(resource.id) || typeof resource.name !== 'string' ||
        !resource.name.trim() || resource.name.length > 80 ||
        /[\u0000-\u001f\u007f<>]/u.test(resource.name) ||
        !['campus', 'direct'].includes(resource.route) ||
        !RESOURCE_CATEGORIES.has(resource.category) ||
        !Array.isArray(keywords) || keywords.length > 12 ||
        keywords.some((keyword) => typeof keyword !== 'string' || keyword.length > 40 ||
          /[\u0000-\u001f\u007f<>]/u.test(keyword)) ||
        typeof resource.favorite !== 'boolean' ||
        (resource.lastOpenedAt !== null &&
         (!Number.isSafeInteger(resource.lastOpenedAt) || resource.lastOpenedAt <= 0))) {
      throw new TypeError('Campus Workspace resource is invalid');
    }
    return Object.freeze({
      id: resource.id,
      name: resource.name.trim(),
      route: resource.route,
      category: resource.category,
      favorite: resource.favorite,
      lastOpenedAt: resource.lastOpenedAt,
      builtin: resource.builtin === true,
      keywords: Object.freeze([...keywords]),
    });
  }));
}

function projectWorkspaceGroups(value) {
  if (!Array.isArray(value) || value.length > 16) {
    throw new TypeError('Campus Workspace groups are invalid');
  }
  const ids = new Set();
  return Object.freeze(value.map((group) => {
    if (!group || typeof group !== 'object' || !GROUP_ID.test(group.id) || ids.has(group.id) ||
        typeof group.name !== 'string' || !group.name.trim() || group.name.length > GROUP_NAME_MAX ||
        /[\u0000-\u001f\u007f<>]/u.test(group.name) || !Array.isArray(group.resourceIds) ||
        group.resourceIds.length > 64 || new Set(group.resourceIds).size !== group.resourceIds.length ||
        group.resourceIds.some((id) => !RESOURCE_ID.test(id))) {
      throw new TypeError('Campus Workspace group is invalid');
    }
    ids.add(group.id);
    return Object.freeze({
      id: group.id,
      name: group.name.trim(),
      resourceIds: Object.freeze([...group.resourceIds]),
    });
  }));
}

class CampusWorkspaceController {
  constructor({
    workspaceFile,
    workspacePreload,
    getProfilePresentation,
    getResources,
    getGroups = () => [],
    getLocale,
    onCommand,
  } = {}) {
    for (const dependency of [getProfilePresentation, getResources, getGroups, getLocale, onCommand]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Campus Workspace controller dependencies are incomplete');
      }
    }
    if (![workspaceFile, workspacePreload].every((value) => typeof value === 'string' && value)) {
      throw new TypeError('Campus Workspace files are invalid');
    }
    Object.assign(this, {
      workspaceFile, workspacePreload, getProfilePresentation, getResources,
      getGroups, getLocale, onCommand,
    });
  }

  state() {
    const profile = this.getProfilePresentation();
    return Object.freeze({
      schoolName: profile.schoolName,
      unverified: profile.unverified === true,
      officialPortalResourceId: profile.officialPortalResourceId || null,
      locale: this.getLocale() === 'en' ? 'en' : 'zh',
      resources: projectWorkspaceResources(this.getResources()),
      groups: projectWorkspaceGroups(this.getGroups()),
    });
  }

  sendState(contents) {
    if (!contents || contents.isDestroyed?.()) return false;
    contents.send?.('campus-workspace-state', this.state());
    return true;
  }

  createView(WebContentsView, browserSession) {
    if (typeof WebContentsView !== 'function' || !browserSession) {
      throw new TypeError('Campus Workspace view environment is incomplete');
    }
    const view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        preload: this.workspacePreload,
        devTools: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        safeDialogs: true,
        backgroundThrottling: true,
      },
    });
    this.attach(view.webContents);
    return view;
  }

  async load(view) {
    if (!view?.webContents || typeof view.webContents.loadFile !== 'function') {
      throw new TypeError('Campus Workspace view cannot load its local file');
    }
    await view.webContents.loadFile(this.workspaceFile);
    this.sendState(view.webContents);
    return true;
  }

  focus(contents, target = 'search', query = '') {
    if (!contents || contents.isDestroyed?.()) return false;
    if (!['search', 'manage'].includes(target)) return false;
    const normalizedQuery = String(query || '').trim();
    if (normalizedQuery.length > 80 || /[\u0000-\u001f\u007f]/u.test(normalizedQuery)) return false;
    contents.send?.('campus-workspace-focus', Object.freeze({ target, query: normalizedQuery }));
    return true;
  }

  focusSearch(contents) { return this.focus(contents, 'search'); }

  attach(contents) {
    contents.on('ipc-message', (_event, channel, payload) => {
      if (channel !== 'campus-workspace-command') return;
      const command = normalizeWorkspaceCommand(payload);
      if (!command) return;
      if (command.command === 'ready') {
        this.sendState(contents);
        return;
      }
      Promise.resolve(this.onCommand(command)).then(() => this.sendState(contents)).catch(() => {});
    });
  }
}

module.exports = {
  CampusWorkspaceController,
  normalizeWorkspaceCommand,
  projectWorkspaceGroups,
  projectWorkspaceResources,
};
