'use strict';

function registerBrowserDataIpc({ register, clearSiteData, translate, campusData = null } = {}) {
  for (const dependency of [register, clearSiteData, translate]) {
    if (typeof dependency !== 'function') {
      throw new TypeError('browser data IPC dependencies are incomplete');
    }
  }
  register('clear-browser-data', async (_event, ...args) => {
    if (args.length !== 0) {
      return { ok: false, error: translate('error.browserDataClearFailed') };
    }
    try {
      if (await clearSiteData() !== true) {
        return { ok: false, error: translate('error.browserDataClearFailed') };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: translate('error.browserDataClearFailed') };
    }
  });
  if (campusData) {
    if (typeof campusData.snapshot !== 'function' ||
        typeof campusData.refreshSchedule !== 'function') {
      throw new TypeError('campus data IPC dependencies are incomplete');
    }
    register('get-campus-data', (_event, ...args) => {
      if (args.length) throw new TypeError('campus data request must be value-free');
      return campusData.snapshot();
    });
    register('refresh-campus-data', (_event, ...args) => {
      if (args.length) throw new TypeError('campus data refresh must be value-free');
      return campusData.snapshot({ force: true });
    });
    register('refresh-campus-schedule', (_event, ...args) => {
      if (args.length) throw new TypeError('campus schedule refresh must be value-free');
      return campusData.refreshSchedule();
    });
  }
}

module.exports = { registerBrowserDataIpc };
