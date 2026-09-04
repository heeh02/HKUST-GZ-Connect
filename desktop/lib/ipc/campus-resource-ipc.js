'use strict';

const {
  canonicalCustomResourceUrl,
  deleteCustomResource,
  hideBuiltinResource,
  reorderCustomResources,
  upsertCustomResource,
} = require('../browser/resources/campus-resource-store');
const { allowedKeys, boundedArray, boundedString } = require('./ipc-guard');

function routePreferenceFromIpc(value) {
  if (!['auto', 'campus', 'direct'].includes(value)) {
    throw new TypeError('网站网络偏好无效');
  }
  return value;
}

function favoriteResourceRequest(value) {
  const source = allowedKeys(value, [
    'name', 'url', 'description', 'routePreference', 'groupId',
  ]);
  return {
    name: boundedString(source.name, { minLength: 1, maxLength: 40, trim: true }),
    url: boundedString(source.url, { minLength: 1, maxLength: 2048, trim: true }),
    description: boundedString(source.description || '', {
      minLength: 0, maxLength: 80, trim: true,
    }),
    routePreference: routePreferenceFromIpc(source.routePreference),
    groupId: source.groupId == null || source.groupId === '' ? null : boundedString(
      source.groupId, { minLength: 1, maxLength: 70, trim: true },
    ),
  };
}

function rollbackEvery(operations) {
  const failures = [];
  for (const operation of operations) {
    try { operation(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, '网站添加回滚不完整');
}

function registerCampusResourceIpc({
  register,
  loadSettings,
  saveSettings,
  runTransaction,
  safeResources,
  activityStore,
  routingPolicy,
  onChanged = () => {},
} = {}) {
  for (const dependency of [register, loadSettings, saveSettings, runTransaction, safeResources]) {
    if (typeof dependency !== 'function') {
      throw new TypeError('campus resource IPC dependencies are incomplete');
    }
  }
  if (!activityStore || typeof activityStore.snapshot !== 'function' ||
      typeof activityStore.toggleFavorite !== 'function' ||
      typeof activityStore.replaceFavorites !== 'function' ||
      typeof activityStore.groupsSnapshot !== 'function' ||
      typeof activityStore.replaceGroups !== 'function' ||
      typeof activityStore.listGroups !== 'function' ||
      typeof activityStore.addResourcesToGroup !== 'function') {
    throw new TypeError('campus resource activity dependencies are incomplete');
  }
  if (!routingPolicy || typeof routingPolicy.resolve !== 'function' ||
      typeof routingPolicy.list !== 'function' || typeof routingPolicy.upsert !== 'function' ||
      typeof routingPolicy.replace !== 'function') {
    throw new TypeError('campus resource route resolver is incomplete');
  }
  if (typeof onChanged !== 'function') throw new TypeError('campus resource change hook is invalid');
  register('save-resource', async (_event, payload) => {
    try {
      const resource = allowedKeys(payload, [
        'id', 'name', 'url', 'description', 'route', 'routePreference',
      ]);
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
      onChanged();
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
  register('create-favorite-resource', async (_event, payload) => {
    try {
      const request = favoriteResourceRequest(payload);
      const canonicalUrl = canonicalCustomResourceUrl(request.url);
      const resolution = routingPolicy.resolve(canonicalUrl);
      const effectiveRoute = request.routePreference === 'auto'
        ? (resolution?.route === 'direct' ? 'direct' : 'campus')
        : request.routePreference;
      const ruleHost = new URL(canonicalUrl).hostname;
      let result;
      let affectedResourceIds = [];
      await runTransaction(() => {
        const previous = loadSettings();
        const previousFavorites = activityStore.snapshot().favorites;
        const previousGroups = activityStore.groupsSnapshot();
        const previousRules = routingPolicy.list();
        const existing = safeResources(previous).find(({ url }) => url === canonicalUrl) || null;
        let next = previous;
        let target = existing;
        if (!existing || existing.builtin !== true) {
          const saved = upsertCustomResource(previous.customResources, {
            ...(existing ? { id: existing.id } : {}),
            name: request.name,
            url: canonicalUrl,
            description: request.description,
            route: effectiveRoute,
            routePreference: 'auto',
          }, { builtinResources: safeResources(previous) });
          target = saved.resource;
          affectedResourceIds = saved.affectedResourceIds || [];
          next = { ...previous, customResources: saved.resources };
        }
        if (request.groupId !== null &&
            !activityStore.listGroups().some(({ id }) => id === request.groupId)) {
          throw new Error('所选分类已不存在');
        }
        const commit = () => {
          let settingsCommitted = false;
          try {
            saveSettings(next);
            settingsCommitted = true;
            const resources = safeResources();
            const favorites = activityStore.snapshot().favorites;
            if (!favorites.entries.includes(target.id)) {
              activityStore.toggleFavorite(target.id, resources);
            }
            if (request.groupId !== null) {
              activityStore.addResourcesToGroup([target.id], request.groupId);
            }
            if (request.routePreference !== 'auto') {
              routingPolicy.upsert({ host: ruleHost, includeSubdomains: false,
                route: request.routePreference });
            }
            result = {
              resource: safeResources().find(({ id }) => id === target.id) || target,
              resources: safeResources(),
              groups: activityStore.listGroups(),
              affectedResourceIds,
              resolution: routingPolicy.resolve(canonicalUrl),
            };
            return result;
          } catch (error) {
            if (settingsCommitted || error.commitApplied === true) error.commitApplied = true;
            throw error;
          }
        };
        return {
          commit,
          rollback: () => rollbackEvery([
            () => saveSettings(previous),
            () => activityStore.replaceFavorites(previousFavorites),
            () => activityStore.replaceGroups(previousGroups),
            () => routingPolicy.replace(previousRules),
          ]),
        };
      });
      onChanged();
      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        rollbackIncomplete: error.rollbackIncomplete === true,
        resources: safeResources(),
        groups: activityStore.listGroups(),
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
      onChanged();
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
      onChanged();
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
      onChanged();
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
      onChanged();
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
