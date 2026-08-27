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

      const commit = () => {
        this.saveSettings(nextSettings);
        const nextFavorites = this.activityStore.toggleFavorite(
          target.id,
          this.visibleResources(nextSettings),
        );
        outcome = Object.freeze({
          ok: true,
          favorite: nextFavorites.entries.includes(target.id),
          resourceId: target.id,
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
          const favorites = this.activityStore.toggleFavorite(command.resourceId, resources);
          outcome = { ok: true, favorite: favorites.entries.includes(command.resourceId) };
        } else if (command.command === 'create-group') {
          this.activityStore.createGroup(command.name); outcome = { ok: true };
        } else if (command.command === 'rename-group') {
          this.activityStore.renameGroup(command.groupId, command.name); outcome = { ok: true };
        } else if (command.command === 'delete-group') {
          this.activityStore.deleteGroup(command.groupId); outcome = { ok: true };
        } else if (command.command === 'reorder-groups') {
          this.activityStore.reorderGroups(command.groupIds); outcome = { ok: true };
        } else if (command.command === 'move-resource') {
          this.activityStore.moveResource(
            command.resourceId, command.groupId, command.index,
          );
          outcome = { ok: true };
        } else {
          throw new Error('workspace command is unsupported');
        }
        this.onChanged?.(outcome);
        return outcome;
      };
      return {
        commit,
        rollback: () => {
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
