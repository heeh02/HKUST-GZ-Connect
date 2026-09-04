'use strict';

const path = require('node:path');
const { resolveResourceById } = require('./campus-resources');
const { projectResourceActivity } = require('./resource-activity');
const { ResourceActivityStore } = require('./resource-activity-store');
const { localizeResources } = require('../presentation/localized-resource-view');
const { normalizePageFavoriteCandidate } = require('../schema/campus-resource-contract');
const { PageFavoriteController } = require('./page-favorite-controller');
const { FavoriteGroupStore } = require('./favorite-group-store');

class ResourceLibraryRuntime {
  constructor({
    favoritesFile,
    recentFile,
    platform,
    loadResources,
    captureContext,
    isContextCurrent,
    openRequest,
    loadAliases = () => [],
    ActivityStoreClass = ResourceActivityStore,
    GroupStoreClass = FavoriteGroupStore,
  } = {}) {
    for (const dependency of [
      loadResources, loadAliases, captureContext, isContextCurrent, openRequest,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('resource library runtime dependencies are incomplete');
      }
    }
    this.loadResources = loadResources;
    this.loadAliases = loadAliases;
    this.captureContext = captureContext;
    this.isContextCurrent = isContextCurrent;
    this.openRequest = openRequest;
    this.activityStore = new ActivityStoreClass({ favoritesFile, recentFile, platform });
    this.groupStore = new GroupStoreClass({
      filePath: path.join(path.dirname(favoritesFile), 'favorite-groups.json'),
      platform,
    });
  }

  list(settings = null) {
    const resources = this.loadResources(settings);
    try {
      const activity = this.#reconcileActivity(settings);
      return projectResourceActivity(resources, activity.favorites, activity.recent);
    } catch {
      return projectResourceActivity(
        resources,
        { schemaVersion: 1, entries: [] },
        { schemaVersion: 1, entries: [] },
      );
    }
  }

  listLocalized(settings = null, locale = 'zh') {
    return localizeResources(this.list(settings), locale);
  }

  resolveRoutes(resources, resolveRoute) {
    if (!Array.isArray(resources) || typeof resolveRoute !== 'function') {
      throw new TypeError('resource route projection dependencies are incomplete');
    }
    return Object.freeze(resources.map((resource) => {
      const resolution = resolveRoute(resource.url);
      return Object.freeze({ ...resource,
        route: resolution?.route === 'direct' ? 'direct' : 'campus',
        routeSource: resolution?.source || 'default' });
    }));
  }

  snapshot() { return this.#reconcileActivity(null); }

  toggleFavorite(resourceId, resources) {
    const next = this.activityStore.toggleFavorite(resourceId, resources);
    if (!next.entries.includes(resourceId)) this.groupStore.removeResource(resourceId);
    return next;
  }

  replaceFavorites(document) {
    return this.activityStore.replaceFavorites(document);
  }

  listGroups() {
    let favorites;
    let resources;
    let document;
    try {
      favorites = new Set(this.#reconcileActivity(null).favorites.entries);
      resources = new Set(this.loadResources().map(({ id }) => id));
      document = this.groupStore.groups();
    }
    catch { return Object.freeze([]); }
    const groups = document.map((group) => Object.freeze({
      ...group,
      resourceIds: Object.freeze(group.resourceIds.filter((id) => favorites.has(id) && resources.has(id))),
    }));
    return Object.freeze(groups);
  }

  groupsSnapshot() { return this.groupStore.snapshot(); }

  replaceGroups(document) { return this.groupStore.replace(document); }

  createGroup(name) { return this.groupStore.create(name); }

  renameGroup(groupId, name) { return this.groupStore.rename(groupId, name); }

  deleteGroup(groupId) { return this.groupStore.remove(groupId); }

  reorderGroups(groupIds) { return this.groupStore.reorder(groupIds); }

  moveResource(resourceId, groupId, index) {
    return this.groupStore.move(
      resourceId,
      groupId,
      index,
      this.activityStore.snapshot().favorites.entries,
    );
  }

  addResourcesToGroup(resourceIds, groupId) {
    return this.groupStore.addMany(
      resourceIds,
      groupId,
      this.activityStore.snapshot().favorites.entries,
    );
  }

  removeResourceFromGroups(resourceId) { return this.groupStore.removeResource(resourceId); }

  recordOpenByUrl(rawUrl) {
    let canonical;
    try {
      canonical = normalizePageFavoriteCandidate({
        url: rawUrl, title: '', route: 'campus',
      }).url;
    } catch {
      return false;
    }
    const resources = this.loadResources();
    const resource = resources.find((entry) => {
      try {
        return normalizePageFavoriteCandidate({
          url: entry.url, title: '', route: entry.route,
        }).url === canonical;
      } catch {
        return false;
      }
    });
    if (!resource) return false;
    this.activityStore.recordOpen(resource.id, resources);
    return true;
  }

  async openById(resourceId, locale = 'zh') {
    const available = this.loadResources();
    const resource = resolveResourceById(available, resourceId);
    const presentation = available.find((candidate) => candidate?.id === resource.id);
    const context = this.captureContext();
    if (!this.isContextCurrent(context)) throw new Error('resource context is stale');
    const result = await this.openRequest({
      url: resource.url,
      route: resource.route,
      displayName: typeof presentation?.name === 'string' && presentation.name
        ? presentation.name : resource.id,
    });
    if (!result?.ok) return result;
    if (this.isContextCurrent(context)) {
      try { this.activityStore.recordOpen(resource.id, this.loadResources()); } catch {}
    }
    return Object.freeze({
      ok: true,
      route: result.route === 'direct' ? 'direct' : 'campus',
      resourceId: resource.id,
      resources: this.listLocalized(null, locale),
    });
  }

  #reconcileActivity(settings) {
    const aliases = this.loadAliases(settings);
    if (!Array.isArray(aliases) || aliases.length > 32 || aliases.some((alias) =>
      !alias || typeof alias !== 'object' || !/^[a-z0-9-]{1,40}$/u.test(alias.from) ||
      !/^[a-z0-9-]{1,40}$/u.test(alias.to))) {
      throw new TypeError('resource activity aliases are invalid');
    }
    const current = this.activityStore.snapshot();
    if (!aliases.length) return current;
    const map = new Map(aliases.map(({ from, to }) => [from, to]));
    const favoriteEntries = [...new Set(current.favorites.entries.map((id) => map.get(id) || id))];
    const recentEntries = [];
    const recentIds = new Set();
    for (const entry of current.recent.entries) {
      const resourceId = map.get(entry.resourceId) || entry.resourceId;
      if (recentIds.has(resourceId)) continue;
      recentIds.add(resourceId);
      recentEntries.push({ resourceId, openedAt: entry.openedAt });
    }
    const nextFavorites = { schemaVersion: 1, entries: favoriteEntries };
    const nextRecent = { schemaVersion: 1, entries: recentEntries };
    if (JSON.stringify(nextFavorites) !== JSON.stringify(current.favorites)) {
      this.activityStore.replaceFavorites(nextFavorites);
    }
    if (JSON.stringify(nextRecent) !== JSON.stringify(current.recent)) {
      if (typeof this.activityStore.replaceRecent !== 'function') {
        throw new Error('resource activity store cannot migrate recent entries');
      }
      this.activityStore.replaceRecent(nextRecent);
    }
    const groupDocument = this.groupStore.snapshot();
    const pairs = new Set();
    const placements = groupDocument.placements.map((placement) => ({
      ...placement,
      resourceId: map.get(placement.resourceId) || placement.resourceId,
    })).filter((placement) => {
      const pair = `${placement.collectionId}\0${placement.resourceId}`;
      if (pairs.has(pair)) return false;
      pairs.add(pair); return true;
    });
    const nextGroups = {
      ...groupDocument,
      placements: groupDocument.collections.flatMap(({ id: collectionId }) => placements
        .filter((placement) => placement.collectionId === collectionId)
        .sort((left, right) => left.order - right.order)
        .map((placement, order) => ({ ...placement, order }))),
    };
    if (JSON.stringify(nextGroups) !== JSON.stringify(groupDocument)) {
      this.groupStore.replace(nextGroups);
    }
    return Object.freeze({
      favorites: this.activityStore.snapshot().favorites,
      recent: this.activityStore.snapshot().recent,
    });
  }
}

module.exports = { FavoriteGroupStore, PageFavoriteController, ResourceLibraryRuntime };
