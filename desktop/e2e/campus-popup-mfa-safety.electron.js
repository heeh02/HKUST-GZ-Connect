'use strict';

// Real Electron/WebContentsView coverage for a cross-origin popup MFA flow.
// Every page, cookie, credential and challenge is synthetic and served from an
// in-memory protocol handler; no school endpoint or real account is touched.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView, session } = require('electron');
const { CampusBrowser } = require('../lib/browser/session/campus-browser');
const { CAMPUS_PARTITION } = require('../lib/routing/policy/campus-route');

const TEST_TIMEOUT_MS = 20_000;
const WAIT_TIMEOUT_MS = 5_000;
const LOGIN_URL = 'https://sso.example.invalid/login';
const CHALLENGE_URL = 'https://mfa.example.invalid/challenge';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-popup-mfa-'));
app.setPath('userData', profile);

const loginPage = `<!doctype html>
  <title>Synthetic SSO</title>
  <form id="login">
    <input id="username" autocomplete="username">
    <input id="password" type="password" autocomplete="current-password">
    <button>Sign in</button>
  </form>
  <script>
    document.getElementById('login').addEventListener('submit', (event) => {
      event.preventDefault();
      document.cookie = 'synthetic_sso=ready; Domain=example.invalid; Path=/; SameSite=Lax; Secure';
      window.open(${JSON.stringify(CHALLENGE_URL)}, 'synthetic-mfa');
      document.body.innerHTML = '<main id="waiting">Waiting for verification</main>';
    });
  </script>`;

const challengePage = `<!doctype html>
  <title>Synthetic MFA</title>
  <main>Enter a second factor.</main>
  <output id="cookie"></output>
  <form id="challenge">
    <input id="otp" type="password" autocomplete="one-time-code" name="otp">
    <button>Verify</button>
  </form>
  <script>
    document.getElementById('cookie').textContent = document.cookie;
    document.getElementById('challenge').addEventListener('submit', (event) => {
      event.preventDefault();
      document.title = 'Portal';
      document.body.innerHTML = '<main id="complete">Signed in</main>';
    });
  </script>`;

let browser = null;
let campusSession = null;

async function waitFor(condition, description) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function installSyntheticHttps(targetSession) {
  await targetSession.protocol.interceptBufferProtocol('https', (request, callback) => {
    const page = request.url === LOGIN_URL ? loginPage : challengePage;
    callback({ mimeType: 'text/html', charset: 'utf-8', data: Buffer.from(page) });
  });
}

async function cleanup() {
  browser?.close();
  browser = null;
  if (campusSession) await campusSession.protocol.uninterceptProtocol('https');
  campusSession = null;
  fs.rmSync(profile, { recursive: true, force: true });
}

async function run() {
  await app.whenReady();
  campusSession = session.fromPartition(CAMPUS_PARTITION);
  await installSyntheticHttps(campusSession);
  const prompts = [];
  const saved = [];
  const errors = [];
  browser = new CampusBrowser({
    BrowserWindow,
    WebContentsView,
    session,
    dialog: {
      showSaveDialog: async () => ({ canceled: true }),
      showMessageBox: async (_window, options) => {
        prompts.push(options);
        return { response: 0 };
      },
    },
    certificateTrust: { isTrusted: () => false, trust: () => {} },
    credentialVault: {
      get: async () => null,
      save: async (...credential) => saved.push(credential),
    },
    parentWindow: () => null,
    toolbarFile: path.join(__dirname, '..', 'renderer', 'campus-browser.html'),
    toolbarPreload: path.join(__dirname, '..', 'lib', 'campus-toolbar-contract.js'),
    campusPreload: path.join(__dirname, '..', 'campus-preload.js'),
    ensureCampusReady: async () => true,
    onError: (message) => errors.push(message),
  });

  await browser.open(LOGIN_URL, 11080, 'campus');
  browser.window.hide();
  const owner = browser.activeTab();
  const ownerContents = owner.view.webContents;
  ownerContents.send('campus-credential-fill', {
    origin: 'https://sso.example.invalid',
    username: 'synthetic-user',
    password: 'synthetic-campus-password',
  });
  await waitFor(
    () => ownerContents.executeJavaScript(
      "document.getElementById('password')?.value === 'synthetic-campus-password'",
    ),
    'ordinary password autofill',
  );
  await ownerContents.executeJavaScript("document.getElementById('login').requestSubmit()");

  await waitFor(() => browser.tabs.length === 2, 'popup conversion into a second tab');
  const popup = browser.activeTab();
  assert.notEqual(popup.id, owner.id);
  assert.equal(popup.view.webContents.session, ownerContents.session,
    'cross-origin SSO tabs must share one persistent Electron Session');
  assert.equal(popup.pendingCredential, null, 'the popup must not receive the staged password');
  await waitFor(
    () => owner.pendingCredential?.challengeObserved === true,
    'popup challenge observation',
  );
  assert.equal(prompts.length, 0, 'the waiting opener cannot prompt during popup MFA');

  const popupState = await popup.view.webContents.executeJavaScript(`({
    otp: document.getElementById('otp').value,
    cookie: document.getElementById('cookie').textContent,
  })`);
  assert.equal(popupState.otp, '', 'the campus password must not enter the popup OTP field');
  assert.match(popupState.cookie, /synthetic_sso=ready/,
    'the cross-origin popup must retain the shared SameSite session cookie');

  await popup.view.webContents.executeJavaScript(`(() => {
    document.getElementById('otp').value = 'synthetic-otp';
    document.getElementById('challenge').requestSubmit();
  })()`);
  await waitFor(() => prompts.length === 1, 'post-challenge credential prompt');
  assert.deepEqual(saved, [[
    'https://sso.example.invalid', 'synthetic-user', 'synthetic-campus-password',
  ]]);
  assert.equal(owner.pendingCredential, null);
  assert.deepEqual(errors, []);
  process.stdout.write('campus popup MFA credential safety: PASS\n');
}

const hardTimeout = setTimeout(() => {
  process.stderr.write('campus popup MFA credential safety: hard timeout\n');
  void cleanup().finally(() => app.exit(1));
}, TEST_TIMEOUT_MS);

run().then(
  async () => {
    clearTimeout(hardTimeout);
    await cleanup();
    app.quit();
  },
  async (error) => {
    clearTimeout(hardTimeout);
    process.stderr.write(`${error.stack || error}\n`);
    await cleanup();
    app.exit(1);
  },
);
