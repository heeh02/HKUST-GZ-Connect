'use strict';

const { allowedKeys, boundedString } = require('./ipc-guard');

function campusOpenRequestFromIpc(value) {
  if (typeof value === 'string') return boundedString(value, { maxLength: 4096 });
  const source = allowedKeys(value, ['url', 'route']);
  const result = { url: boundedString(source.url ?? '', { maxLength: 4096 }) };
  if (source.route != null) {
    if (source.route !== 'campus' && source.route !== 'direct') {
      throw new TypeError('校园浏览器路径无效');
    }
    result.route = source.route;
  }
  return result;
}

function registerCoreControlIpc(dependencies = {}) {
  const {
    register, getState, connect, disconnect, reconnect, sshConfig, copyClashNode,
    getLogs, openLog, copyText, openCampusBrowser, checkUpdate, openExternal, resize,
  } = dependencies;
  for (const dependency of [
    register, getState, connect, disconnect, reconnect, sshConfig, copyClashNode,
    getLogs, openLog, copyText, openCampusBrowser, checkUpdate, openExternal, resize,
  ]) {
    if (typeof dependency !== 'function') {
      throw new TypeError('core control IPC dependencies are incomplete');
    }
  }

  register('get-state', () => getState());
  register('connect', () => connect());
  register('disconnect', () => disconnect());
  register('reconnect', () => reconnect());
  register('ssh-config', () => sshConfig());
  register('copy-clash-node', () => copyClashNode());
  register('get-logs', () => getLogs());
  register('open-log', () => openLog());
  register('copy', (_event, text) => (
    copyText(boundedString(text ?? '', { maxLength: 16 * 1024 }))
  ));
  register('open-campus-browser', (_event, request) => (
    openCampusBrowser(campusOpenRequestFromIpc(request))
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
  registerCoreControlIpc,
};
