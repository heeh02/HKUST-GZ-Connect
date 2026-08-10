'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  assertEnginePresent,
  assertProxyCommandPresent,
  requiredEngineName,
  requiredProxyCommandName,
} = require('../build/afterPack');
const { assertCustomResourceManager, resolveResourcesDirectory } = require('../build/verify-package');

test('packaging maps each target to its required engine name', () => {
  assert.equal(requiredEngineName('darwin', 'arm64'), 'ec-engine-darwin-arm64');
  assert.equal(requiredEngineName('darwin', 3), 'ec-engine-darwin-arm64');
  assert.equal(requiredEngineName('win32', 'x64'), 'ec-engine-windows-amd64.exe');
  assert.equal(requiredProxyCommandName('darwin', 'arm64'), 'ec-proxy-command-darwin-arm64');
  assert.equal(requiredProxyCommandName('win32', 'x64'), 'ec-proxy-command-windows-amd64.exe');
});

test('packaging fails before signing when the SSH proxy helper is absent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-helper-'));
  assert.throws(
    () => assertProxyCommandPresent(directory, 'darwin', 'arm64'),
    /missing packaged SSH proxy helper:.*ec-proxy-command-darwin-arm64/,
  );
});

test('packaging fails before signing when the native engine is absent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-engine-'));
  assert.throws(
    () => assertEnginePresent(directory, 'darwin', 'arm64'),
    /missing packaged engine:.*ec-engine-darwin-arm64/,
  );
});

test('package verification accepts either a macOS app or its Resources directory', () => {
  const appPath = path.join(os.tmpdir(), 'hkustgzconnect.app');
  const resources = path.join(appPath, 'Contents', 'Resources');
  assert.equal(resolveResourcesDirectory(appPath), resources);
  assert.equal(resolveResourcesDirectory(resources), resources);
});

test('package verification rejects a build without the custom website manager', () => {
  assert.throws(
    () => assertCustomResourceManager({ html: '', renderer: '', preload: '', main: '' }),
    /custom resource manager is incomplete:.*manage button.*save handler/m,
  );

  assert.doesNotThrow(() => assertCustomResourceManager({
    html: 'id="manageResources" id="resourceDialog" id="saveResource" id="quickAddCampus" id="resourceSaved"',
    renderer: 'window.api.saveResource function suggestedResourceName',
    preload: "saveResource: (resource) => ipcRenderer.invoke('save-resource', resource)",
    main: "ipcMain.handle('save-resource' app.on('certificate-error'",
  }));

  assert.doesNotThrow(() => assertCustomResourceManager({
    html: 'id="manageResources" id="resourceDialog" id="saveResource" id="quickAddCampus" id="resourceSaved"',
    renderer: 'window.api.saveResource function suggestedResourceName',
    preload: "saveResource: (resource) => ipcRenderer.invoke('save-resource', resource)",
    main: "trustedHandle('save-resource' app.on('certificate-error'",
  }));
});
