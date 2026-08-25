'use strict';

const path = require('node:path');
const {
  createDisabledIntegrationCenterRuntime,
  createIntegrationCenterRuntime,
} = require('../integrations/integration-center-runtime');
const {
  createIntegrationRuntimeContext,
} = require('../integrations/integration-runtime-context');

function selectedFile(result) {
  if (!result || result.canceled === true) return null;
  if (typeof result.filePath === 'string' && result.filePath) return result.filePath;
  if (Array.isArray(result.filePaths) && result.filePaths.length === 1) return result.filePaths[0];
  return null;
}

function createIntegrationTargetSelector({
  dialog,
  getParentWindow,
  homeDirectory,
} = {}) {
  if (!dialog || typeof dialog.showSaveDialog !== 'function' ||
      typeof getParentWindow !== 'function' ||
      typeof homeDirectory !== 'string' || !path.isAbsolute(homeDirectory)) {
    throw new TypeError('integration target selector dependencies are invalid');
  }
  const invoke = (method, options) => {
    const parent = getParentWindow();
    return parent ? dialog[method](parent, options) : dialog[method](options);
  };
  return async ({ adapterId, action } = {}) => {
    if (action === 'save') {
      const names = {
        clash_yaml: ['campus-connect-clash.yaml', [{ name: 'YAML', extensions: ['yaml', 'yml'] }]],
        mihomo_yaml: ['campus-connect-mihomo.yaml', [{ name: 'YAML', extensions: ['yaml', 'yml'] }]],
      };
      const selected = names[adapterId];
      if (!selected) return null;
      return selectedFile(await invoke('showSaveDialog', {
        title: 'Save Campus Connect integration',
        defaultPath: path.join(homeDirectory, selected[0]),
        filters: selected[1],
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      }));
    }
    return null;
  };
}

function createExternalIntegrationRuntime({
  enabled,
  workspaceRoot,
  getAuthority,
  withProfileDocument,
  getSettings,
  getUserRules,
  getServerResources,
  getCampusCidrs = () => [],
  getProxyCredential,
  getPacSource,
  ensureSidecar,
  writeClipboard,
  helperPath,
  credentialFile,
  selectTarget,
  fileSystem,
  platform,
  windowsAcl,
} = {}) {
  if (enabled !== true) return createDisabledIntegrationCenterRuntime();
  for (const dependency of [
    getAuthority, withProfileDocument, getSettings, getUserRules, getServerResources,
    getCampusCidrs, getProxyCredential, getPacSource, ensureSidecar, writeClipboard, selectTarget,
  ]) {
    if (typeof dependency !== 'function') {
      throw new TypeError('external integration runtime dependencies are incomplete');
    }
  }
  return createIntegrationCenterRuntime({
    workspaceRoot,
    helperPath,
    credentialFile,
    ensureSidecar,
    writeClipboard,
    selectTarget,
    fileSystem,
    platform,
    windowsAcl,
    getContext: () => withProfileDocument((profileDocument) => createIntegrationRuntimeContext({
      authority: getAuthority(),
      profileDocument,
      settings: getSettings(),
      userRules: getUserRules(),
      serverResources: getServerResources(),
      campusCidrs: getCampusCidrs(),
      proxyCredential: getProxyCredential(),
      pacSource: getPacSource(),
      engineGeneration: null,
    })),
  });
}

module.exports = {
  createExternalIntegrationRuntime,
  createIntegrationTargetSelector,
  selectedIntegrationTargetFile: selectedFile,
};
