'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPreload() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const invocations = [];
  const listeners = new Map();
  let exposed = null;
  const ipcRenderer = {
    invoke(channel, payload) {
      invocations.push({ channel, payload, argumentCount: arguments.length });
      return Promise.resolve({ channel, payload });
    },
    on(channel, listener) { listeners.set(channel, listener); },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
  vm.runInNewContext(source, {
    require(request) {
      assert.equal(request, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, 'api');
            exposed = value;
          },
        },
        ipcRenderer,
      };
    },
  }, { filename: 'preload.js' });
  return { api: exposed, invocations, listeners };
}

test('control preload exposes narrow routing-rule IPC methods', async () => {
  const { api, invocations } = loadPreload();
  assert.equal(typeof api.invoke, 'undefined', 'must not expose raw ipcRenderer.invoke');
  assert.equal(typeof api.send, 'undefined', 'must not expose raw ipcRenderer.send');

  const rule = {
    host: 'login.microsoftonline.com',
    includeSubdomains: false,
    route: 'direct',
    previous: { host: 'old.example', includeSubdomains: true },
  };
  const identity = { host: rule.host, includeSubdomains: false };
  await api.listRoutingRules();
  await api.saveRoutingRule(rule);
  await api.deleteRoutingRule(identity);

  assert.deepEqual(invocations.map(({ channel }) => channel), [
    'list-routing-rules',
    'save-routing-rule',
    'delete-routing-rule',
  ]);
  assert.equal(invocations[0].argumentCount, 1, 'list has no renderer-controlled payload');
  assert.equal(invocations[1].payload, rule, 'save forwards only the explicit rule value');
  assert.equal(invocations[2].payload, identity, 'delete forwards only the stable identity');
});

test('control preload exposes narrow certificate-pin IPC methods', async () => {
  const { api, invocations } = loadPreload();
  const identity = { origin: 'https://legacy-campus.example:4433' };
  await api.listCertificatePins();
  await api.deleteCertificatePin(identity);

  assert.deepEqual(invocations.map(({ channel }) => channel), [
    'list-certificate-pins',
    'delete-certificate-pin',
  ]);
  assert.equal(invocations[0].argumentCount, 1, 'list has no renderer-controlled payload');
  assert.equal(invocations[1].payload, identity);
});

test('Clash copy is a value-free trusted IPC and never returns YAML through the renderer', async () => {
  const { api, invocations } = loadPreload();
  const result = await api.copyClashNode();
  assert.equal(result.channel, 'copy-clash-node');
  assert.deepEqual(invocations, [{
    channel: 'copy-clash-node',
    payload: undefined,
    argumentCount: 1,
  }]);
});

test('routing manager open event is value-free and removable', () => {
  const { api, listeners } = loadPreload();
  let opened = 0;
  const unsubscribe = api.onOpenRoutingRules(() => { opened += 1; });
  const listener = listeners.get('open-routing-rules');
  assert.equal(typeof listener, 'function');
  listener({ ignored: true }, { untrusted: true });
  assert.equal(opened, 1, 'renderer callback receives no main-process payload');
  unsubscribe();
  assert.equal(listeners.has('open-routing-rules'), false);
});

test('interactive auth preload exposes only response, resend, cancel and sanitized events', async () => {
  const { api, invocations, listeners } = loadPreload();
  assert.equal(typeof api.getAuthCookie, 'undefined');
  assert.equal(typeof api.getAuthTransaction, 'undefined');
  await api.respondAuthChallenge('synthetic-response');
  await api.resendAuthChallenge();
  await api.cancelAuthChallenge();
  assert.deepEqual(invocations.slice(-3).map(({ channel }) => channel), [
    'respond-auth-challenge',
    'resend-auth-challenge',
    'cancel-auth-challenge',
  ]);
  assert.equal(invocations.at(-3).payload.response, 'synthetic-response');
  assert.equal(invocations.at(-2).argumentCount, 1);
  assert.equal(invocations.at(-1).argumentCount, 1);

  let received;
  const unsubscribe = api.onAuthChallenge((challenge) => { received = challenge; });
  listeners.get('auth-challenge')({}, { kind: 'otp' });
  assert.deepEqual(received, { kind: 'otp' });
  unsubscribe();
  assert.equal(listeners.has('auth-challenge'), false);
});
