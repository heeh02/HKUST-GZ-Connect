'use strict';

const {
  deleteCustomResource,
  reorderCustomResources,
  upsertCustomResource,
} = require('./campus-resource-store');
const { allowedKeys, boundedArray, boundedString } = require('./ipc-guard');

function registerCampusResourceIpc({
  register,
  loadSettings,
  saveSettings,
  runTransaction,
  safeResources,
} = {}) {
  for (const dependency of [register, loadSettings, saveSettings, runTransaction, safeResources]) {
    if (typeof dependency !== 'function') {
      throw new TypeError('campus resource IPC dependencies are incomplete');
    }
  }
  register('save-resource', async (_event, payload) => {
    try {
      const resource = allowedKeys(payload, ['id', 'name', 'url', 'description', 'route']);
      let result;
      await runTransaction(() => {
        const previous = loadSettings();
        result = upsertCustomResource(previous.customResources, resource);
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
        const resources = deleteCustomResource(previous.customResources, safeId);
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
}

module.exports = {
  registerCampusResourceIpc,
};
