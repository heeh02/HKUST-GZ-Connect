'use strict';

const path = require('node:path');
const {
  createDisabledIntegrationCenterRuntime,
  createIntegrationCenterRuntime,
} = require('./integrations/integration-center-runtime');
const {
  createIntegrationRuntimeContext,
} = require('./integrations/integration-runtime-context');
const {
  buildClashProxyYaml,
  buildSshProxyCommand,
} = require('./external-proxy-config');

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
      typeof dialog.showOpenDialog !== 'function' || typeof getParentWindow !== 'function' ||
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
        pac: ['campus-connect.pac', [{ name: 'PAC', extensions: ['pac'] }]],
        manual_export: ['campus-connect.json', [{ name: 'JSON', extensions: ['json'] }]],
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
    const openSsh = adapterId === 'openssh_proxy_command';
    if (!openSsh && adapterId !== 'clash_verge_rev_managed') return null;
    return selectedFile(await invoke('showOpenDialog', {
      title: openSsh ? 'Select your OpenSSH .ssh/config' : 'Select Clash Verge Rev global Script.js',
      defaultPath: openSsh ? path.join(homeDirectory, '.ssh', 'config') : homeDirectory,
      filters: openSsh
        ? [{ name: 'OpenSSH config', extensions: ['config', '*'] }]
        : [{ name: 'JavaScript', extensions: ['js'] }],
      properties: ['openFile'],
    }));
  };
}

function createExternalIntegrationRuntime({
  enabled,
  workspaceRoot,
  recordFile,
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
    recordFile,
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

function createLegacyExternalProxyActions({
  getSettings,
  ensureAccess,
  currentGeneration,
  hasActiveEngine,
  activeAuthentication,
  reconnect,
  writeClipboard,
  helperPath,
  credentialFile,
  profileId,
  errorText,
} = {}) {
  for (const dependency of [
    getSettings, ensureAccess, currentGeneration, hasActiveEngine, activeAuthentication,
    reconnect, writeClipboard, helperPath, credentialFile, profileId, errorText,
  ]) {
    if (typeof dependency !== 'function') {
      throw new TypeError('legacy external proxy action dependencies are incomplete');
    }
  }
  return Object.freeze({
    sshConfig: () => {
      try {
        const settings = getSettings();
        ensureAccess(Number(settings.port));
        return buildSshProxyCommand({
          helperPath: helperPath(), credentialFile: credentialFile(), profileId: profileId(),
        });
      } catch { throw new Error(errorText()); }
    },
    copyClashNode: async () => {
      try {
        const settings = getSettings();
        const credential = ensureAccess(Number(settings.port));
        const generation = currentGeneration();
        if (hasActiveEngine() && !activeAuthentication(generation)) {
          const switched = await reconnect();
          if (!switched?.ok) return { ok: false, error: errorText() };
        }
        writeClipboard(buildClashProxyYaml({ port: settings.port, credential }));
        return { ok: true };
      } catch { return { ok: false, error: errorText() }; }
    },
  });
}

module.exports = {
  createExternalIntegrationRuntime,
  createIntegrationTargetSelector,
  createLegacyExternalProxyActions,
  selectedIntegrationTargetFile: selectedFile,
};
