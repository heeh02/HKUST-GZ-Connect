'use strict';

const { allowedKeys, boundedString } = require('./ipc-guard');

function campusOpenRequestFromIpc(value) {
  if (value == null) return { url: '' };
  if (typeof value === 'string') return boundedString(value, { maxLength: 4096 });
  const source = allowedKeys(value, ['url']);
  return { url: boundedString(source.url ?? '', { maxLength: 4096 }) };
}

function resourceOpenRequestFromIpc(value) {
  const source = allowedKeys(value, ['resourceId']);
  return Object.freeze({
    resourceId: boundedString(source.resourceId, {
      minLength: 1,
      maxLength: 40,
      trim: true,
      message: '校园资源无效',
    }),
  });
}

function registerCoreControlIpc(dependencies = {}) {
  const {
    register, getState, getLoginAccount, connect, disconnect, reconnect,
    getLogs, openLog, copyText, openCampusBrowser, openBookmarkManager, openResource, checkUpdate, openExternal, resize,
  } = dependencies;
  for (const dependency of [
    register, getState, getLoginAccount, connect, disconnect, reconnect,
    getLogs, openLog, copyText, openCampusBrowser, openBookmarkManager, openResource, checkUpdate, openExternal, resize,
  ]) {
    if (typeof dependency !== 'function') {
      throw new TypeError('core control IPC dependencies are incomplete');
    }
  }

  register('get-state', () => getState());
  register('get-login-account', () => getLoginAccount());
  register('connect', () => connect());
  register('disconnect', () => disconnect());
  register('reconnect', () => reconnect());
  register('get-logs', () => getLogs());
  register('open-log', () => openLog());
  register('copy', (_event, text) => (
    copyText(boundedString(text ?? '', { maxLength: 16 * 1024 }))
  ));
  register('open-campus-browser', (_event, request) => (
    openCampusBrowser(campusOpenRequestFromIpc(request))
  ));
  register('open-bookmark-manager', () => openBookmarkManager());
  register('open-resource', (_event, request) => (
    openResource(resourceOpenRequestFromIpc(request))
  ));
  register('check-update', (_event, force) => {
    if (typeof force !== 'boolean') throw new TypeError('更新检查参数无效');
    return checkUpdate(force);
  });
  register('open-external', (_event, url) => (
    openExternal(boundedString(url, { minLength: 1, maxLength: 2048 }))
  ));
  register('resize', (_event, height) => {
    if (!Number.isFinite(height)) throw new TypeError('窗口尺寸无效');
    return resize(height);
  });
}

module.exports = {
  campusOpenRequestFromIpc,
  resourceOpenRequestFromIpc,
  registerCoreControlIpc,
};
