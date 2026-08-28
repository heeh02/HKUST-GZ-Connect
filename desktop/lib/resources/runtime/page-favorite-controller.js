'use strict';

const crypto = require('node:crypto');
const {
  MAX_CUSTOM_RESOURCES,
  normalizeCustomResources,
} = require('./campus-resources');
const { normalizePageFavoriteCandidate } = require('../schema/campus-resource-contract');

function capturedResource(existing, candidate) {
  const resources = normalizeCustomResources(existing);
  if (resources.length >= MAX_CUSTOM_RESOURCES) {
    throw new Error(`自定义网站最多保存 ${MAX_CUSTOM_RESOURCES} 个`);
  }
  const digest = crypto.createHash('sha256').update(candidate.url).digest('hex').slice(0, 8);
  let id = `custom-${digest}`;
  let suffix = 2;
  while (resources.some((resource) => resource.id === id)) id = `custom-${digest}-${suffix++}`;
  const next = normalizeCustomResources([...resources, {
    id,
    name: candidate.title,
    description: '',
    url: candidate.url,
    route: candidate.route,
    category: 'custom',
    keywords: [],
    favoriteOnly: true,
  }]);
  const resource = next.find((entry) => entry.id === id);
  if (!resource) throw new Error('当前页面不能保存到收藏');
  return { resource, resources: next };
}

class PageFavoriteController {
  constructor({
    loadSettings,
    saveSettings,
    allResources,
    visibleResources,
    activityStore,
    runTransaction,
    onChanged = null,
  } = {}) {
    for (const dependency of [
      loadSettings, saveSettings, allResources, visibleResources, runTransaction,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('page favorite controller dependencies are incomplete');
      }
    }
    if (!activityStore || typeof activityStore.snapshot !== 'function' ||
        typeof activityStore.toggleFavorite !== 'function' ||
        typeof activityStore.replaceFavorites !== 'function') {
      throw new TypeError('page favorite activity store is incomplete');
    }
    Object.assign(this, {
      loadSettings,
      saveSettings,
      allResources,
      visibleResources,
      activityStore,
      runTransaction,
      onChanged: typeof onChanged === 'function' ? onChanged : null,
    });
  }

  async toggle(rawCandidate) {
    const candidate = normalizePageFavoriteCandidate(rawCandidate);
    let outcome = null;
    await this.runTransaction(() => {
      const previousSettings = this.loadSettings();
      const previousFavorites = this.activityStore.snapshot().favorites;
      const previousGroups = this.activityStore.groupsSnapshot?.() || null;
      const all = this.allResources(previousSettings);
      let target = all.find(({ url }) => url === candidate.url) || null;
      let nextSettings = previousSettings;

      if (target?.builtin === true &&
          previousSettings.hiddenBuiltinResourceIds?.includes(target.id)) {
        nextSettings = {
          ...previousSettings,
          hiddenBuiltinResourceIds: previousSettings.hiddenBuiltinResourceIds.filter(
            (id) => id !== target.id,
          ),
        };
      } else if (!target) {
        const saved = capturedResource(previousSettings.customResources, candidate);
        target = { ...saved.resource, builtin: false };
        nextSettings = { ...previousSettings, customResources: saved.resources };
      }

      const removesCapturedResource = target.favoriteOnly === true &&
        previousFavorites.entries.includes(target.id);
      if (removesCapturedResource) {
        nextSettings = {
          ...previousSettings,
          customResources: previousSettings.customResources.filter(({ id }) => id !== target.id),
        };
      }

      const commit = () => {
        this.saveSettings(nextSettings);
        const nextFavorites = this.activityStore.toggleFavorite(
          target.id,
          this.visibleResources(removesCapturedResource ? previousSettings : nextSettings),
        );
        outcome = Object.freeze({
          ok: true,
          favorite: nextFavorites.entries.includes(target.id),
          resourceId: target.id,
          removedResource: removesCapturedResource,
        });
        this.onChanged?.(outcome);
        return outcome;
      };
      const rollback = () => {
        this.saveSettings(previousSettings);
        this.activityStore.replaceFavorites(previousFavorites);
        if (previousGroups) this.activityStore.replaceGroups(previousGroups);
      };
      return { commit, rollback };
    });
    return outcome || Object.freeze({ ok: false, error: 'page favorite transaction failed' });
  }

  async handleWorkspaceCommand(command) {
    if (!command || typeof command !== 'object') throw new TypeError('workspace command is invalid');
    let outcome = null;
    await this.runTransaction(() => {
      const settings = this.loadSettings();
      const resources = this.visibleResources(settings);
      const previousFavorites = this.activityStore.snapshot().favorites;
      const previousGroups = this.activityStore.groupsSnapshot();
      const commit = () => {
        if (command.command === 'toggle-favorite') {
          const target = resources.find(({ id }) => id === command.resourceId);
          const removeCaptured = target?.favoriteOnly === true &&
            previousFavorites.entries.includes(command.resourceId);
          if (removeCaptured) {
            this.saveSettings({
              ...settings,
              customResources: settings.customResources.filter(({ id }) => id !== command.resourceId),
            });
          }
          const favorites = this.activityStore.toggleFavorite(command.resourceId, resources);
          outcome = {
            ok: true,
            favorite: favorites.entries.includes(command.resourceId),
            removedResource: removeCaptured,
          };
        } else if (command.command === 'rename-resource') {
          const current = settings.customResources.find(({ id }) => id === command.resourceId);
          if (!current) throw new Error('custom resource is unavailable');
          const customResources = normalizeCustomResources(settings.customResources.map((resource) => (
            resource.id === command.resourceId ? { ...resource, name: command.name } : resource
          )));
          if (customResources.length !== settings.customResources.length) {
            throw new Error('custom resource rename failed');
          }
          this.saveSettings({ ...settings, customResources });
          outcome = { ok: true, resourceId: command.resourceId };
        } else if (command.command === 'delete-resource') {
          if (!settings.customResources.some(({ id }) => id === command.resourceId)) {
            throw new Error('custom resource is unavailable');
          }
          this.saveSettings({
            ...settings,
            customResources: settings.customResources.filter(({ id }) => id !== command.resourceId),
          });
          this.activityStore.replaceFavorites({
            schemaVersion: 1,
            entries: previousFavorites.entries.filter((id) => id !== command.resourceId),
          });
          this.activityStore.removeResourceFromGroups(command.resourceId);
          outcome = { ok: true, resourceId: command.resourceId };
        } else if (command.command === 'create-group') {
          this.activityStore.createGroup(command.name); outcome = { ok: true };
        } else if (command.command === 'rename-group') {
          this.activityStore.renameGroup(command.groupId, command.name); outcome = { ok: true };
        } else if (command.command === 'delete-group') {
          this.activityStore.deleteGroup(command.groupId); outcome = { ok: true };
        } else if (command.command === 'reorder-groups') {
          this.activityStore.reorderGroups(command.groupIds); outcome = { ok: true };
        } else if (command.command === 'move-resource') {
          if (!previousFavorites.entries.includes(command.resourceId)) {
            this.activityStore.toggleFavorite(command.resourceId, resources);
          }
          this.activityStore.moveResource(
            command.resourceId, command.groupId, command.index,
          );
          outcome = { ok: true, favorite: true };
        } else if (command.command === 'add-resources-to-group') {
          for (const resourceId of command.resourceIds) {
            if (!resources.some(({ id }) => id === resourceId)) throw new Error('resource is unavailable');
            if (!this.activityStore.snapshot().favorites.entries.includes(resourceId)) {
              this.activityStore.toggleFavorite(resourceId, resources);
            }
          }
          this.activityStore.addResourcesToGroup(command.resourceIds, command.groupId);
          outcome = { ok: true, favorite: true, count: command.resourceIds.length };
        } else {
          throw new Error('workspace command is unsupported');
        }
        this.onChanged?.(outcome);
        return outcome;
      };
      return {
        commit,
        rollback: () => {
          this.saveSettings(settings);
          this.activityStore.replaceFavorites(previousFavorites);
          this.activityStore.replaceGroups(previousGroups);
        },
      };
    });
    return outcome || { ok: false };
  }
}

module.exports = {
  PageFavoriteController,
  normalizePageFavoriteCandidate,
};
