'use strict';

const { resolveResourceById } = require('./campus-resources');
const { projectResourceActivity } = require('./resource-activity');
const { ResourceActivityStore } = require('./resource-activity-store');
const { localizeResources } = require('../presentation/localized-resource-view');

class ResourceLibraryRuntime {
  constructor({
    favoritesFile,
    recentFile,
    platform,
    loadResources,
    captureContext,
    isContextCurrent,
    openRequest,
    ActivityStoreClass = ResourceActivityStore,
  } = {}) {
    for (const dependency of [loadResources, captureContext, isContextCurrent, openRequest]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('resource library runtime dependencies are incomplete');
      }
    }
    this.loadResources = loadResources;
    this.captureContext = captureContext;
    this.isContextCurrent = isContextCurrent;
    this.openRequest = openRequest;
    this.activityStore = new ActivityStoreClass({ favoritesFile, recentFile, platform });
  }

  list(settings = null) {
    const resources = this.loadResources(settings);
    try {
      const activity = this.activityStore.snapshot();
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

  snapshot() { return this.activityStore.snapshot(); }

  toggleFavorite(resourceId, resources) {
    return this.activityStore.toggleFavorite(resourceId, resources);
  }

  replaceFavorites(document) {
    return this.activityStore.replaceFavorites(document);
  }

  async openById(resourceId, locale = 'zh') {
    const resource = resolveResourceById(this.loadResources(), resourceId);
    const context = this.captureContext();
    if (!this.isContextCurrent(context)) throw new Error('resource context is stale');
    const result = await this.openRequest({ url: resource.url, route: resource.route });
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
}

module.exports = { ResourceLibraryRuntime };
