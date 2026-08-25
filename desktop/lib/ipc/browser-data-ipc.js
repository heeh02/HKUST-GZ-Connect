'use strict';

function registerBrowserDataIpc({ register, clearSiteData, translate } = {}) {
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
}

module.exports = { registerBrowserDataIpc };
