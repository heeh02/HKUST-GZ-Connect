'use strict';

const {
  deleteCustomResource,
  hideBuiltinResource,
  reorderCustomResources,
  upsertCustomResource,
} = require('../browser/resources/campus-resource-store');
const { allowedKeys, boundedArray, boundedString } = require('./ipc-guard');

function registerCampusResourceIpc({
  register,
  loadSettings,
  saveSettings,
  runTransaction,
  safeResources,
  activityStore,
} = {}) {
  for (const dependency of [register, loadSettings, saveSettings, runTransaction, safeResources]) {
    if (typeof dependency !== 'function') {
      throw new TypeError('campus resource IPC dependencies are incomplete');
    }
  }
  if (!activityStore || typeof activityStore.snapshot !== 'function' ||
      typeof activityStore.toggleFavorite !== 'function' ||
      typeof activityStore.replaceFavorites !== 'function') {
    throw new TypeError('campus resource activity dependencies are incomplete');
  }
  register('save-resource', async (_event, payload) => {
    try {
      const resource = allowedKeys(payload, ['id', 'name', 'url', 'description', 'route']);
      let result;
      await runTransaction(() => {
        const previous = loadSettings();
        result = upsertCustomResource(previous.customResources, resource, {
          builtinResources: safeResources(),
        });
        return {
          commit: () => saveSettings({ ...previous, customResources: result.resources }),
          rollback: () => saveSettings(previous),
        };
      });
      return {
        ok: true,
        resource: result.resource,
        resources: safeResources(),
        warning: null,
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        rollbackIncomplete: error.rollbackIncomplete === true,
        resources: safeResources(),
      };
    }
  });
  register('delete-resource', async (_event, id) => {
    try {
      const safeId = boundedString(id, { minLength: 1, maxLength: 40, trim: true });
      await runTransaction(() => {
        const previous = loadSettings();
        const visibleResources = safeResources(previous);
        const target = visibleResources.find((resource) => resource?.id === safeId);
        if (!target) throw new Error('网站不存在');
        const next = target.builtin === true
          ? {
            ...previous,
            hiddenBuiltinResourceIds: hideBuiltinResource(
              previous.hiddenBuiltinResourceIds,
              safeId,
              { builtinResources: visibleResources },
            ),
          }
          : {
            ...previous,
            customResources: deleteCustomResource(previous.customResources, safeId),
          };
        return {
          commit: () => saveSettings(next),
          rollback: () => saveSettings(previous),
        };
      });
      return { ok: true, resources: safeResources(), warning: null };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        rollbackIncomplete: error.rollbackIncomplete === true,
        resources: safeResources(),
      };
    }
  });
  register('restore-builtin-resources', async () => {
    try {
      await runTransaction(() => {
        const previous = loadSettings();
        return {
          commit: () => saveSettings({ ...previous, hiddenBuiltinResourceIds: [] }),
          rollback: () => saveSettings(previous),
        };
      });
      return { ok: true, resources: safeResources(), warning: null };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        rollbackIncomplete: error.rollbackIncomplete === true,
        resources: safeResources(),
      };
    }
  });
  register('reorder-resources', async (_event, ids) => {
    try {
      const safeIds = boundedArray(
        ids,
        (id) => boundedString(id, { minLength: 1, maxLength: 40, trim: true }),
        { maxLength: 32 },
      );
      await runTransaction(() => {
        const previous = loadSettings();
        const resources = reorderCustomResources(previous.customResources, safeIds);
        return {
          commit: () => saveSettings({ ...previous, customResources: resources }),
          rollback: () => saveSettings(previous),
        };
      });
      return { ok: true, resources: safeResources(), warning: null };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        rollbackIncomplete: error.rollbackIncomplete === true,
        resources: safeResources(),
      };
    }
  });
  register('toggle-resource-favorite', async (_event, payload) => {
    try {
      const request = allowedKeys(payload, ['resourceId']);
      const resourceId = boundedString(request.resourceId, {
        minLength: 1,
        maxLength: 40,
        trim: true,
      });
      await runTransaction(() => {
        const resources = safeResources();
        const previous = activityStore.snapshot().favorites;
        const previousGroups = activityStore.groupsSnapshot?.() || null;
        return {
          commit: () => activityStore.toggleFavorite(resourceId, resources),
          rollback: () => {
            activityStore.replaceFavorites(previous);
            if (previousGroups) activityStore.replaceGroups(previousGroups);
          },
        };
      });
      return { ok: true, resources: safeResources() };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        rollbackIncomplete: error.rollbackIncomplete === true,
        resources: safeResources(),
      };
    }
  });
}

module.exports = {
  registerCampusResourceIpc,
};
