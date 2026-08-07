# Keychain, Signing, and Test-Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Use a stable Apple signature for local macOS packages whenever available, avoid Keychain access during ordinary password-presence checks, and make packaged-app tests isolate every app-owned data file.

**Architecture:** Pure modules parse public signing metadata, choose a local identity without storing it, resolve package resources, and validate an explicit app-data override. The existing credential store gains a non-decrypting presence check. Main wires those helpers before acquiring the single-instance lock; the package hook and verifier consume the signing helpers.

**Tech Stack:** Node.js CommonJS, Electron safeStorage/app paths, macOS security and codesign command-line tools, electron-builder.

## Global Constraints

- Never read, display, decrypt, upload, migrate, or delete a credential or Keychain secret.
- Preserve the existing encrypted cred.bin format and one-file replacement semantics.
- Prefer Developer ID Application, then Apple Development, for local signing; keep supplied CSC_LINK or explicit CSC_IDENTITY_AUTO_DISCOVERY under electron-builder control.
- Keep Apple Distribution available for a future store pipeline; do not add App Sandbox entitlements or claim App Store readiness.
- Reject a relative HKUSTGZ_USER_DATA_DIR override before any application data file is selected.
- Do not alter EasyConnect engine behavior, system network configuration, browser routing, or the user-owned README.md.

---

## File structure

| File | Responsibility |
| --- | --- |
| desktop/build/macos-signing.js | Parse public identity/signature text and select local signing policy. |
| desktop/build/afterPack.js | Sign bundled engine/app with selected local identity or the ad-hoc fallback. |
| desktop/build/verify-package.js | Accept an app or Resources path, verify package content, and report macOS signing class. |
| desktop/lib/credential-store.js | Test password-file presence without decrypting it. |
| desktop/lib/app-data-dir.js | Validate and resolve the private absolute app-data override. |
| desktop/main.js | Set an approved user-data override before single-instance/state initialization and avoid decrypting for UI state. |
| desktop/test/macos-signing.test.js | Unit-test identity parsing, selection, signature classification, and packaging path resolution. |
| desktop/test/credential-store.test.js | Unit-test non-decrypting presence checks. |
| desktop/test/app-data-dir.test.js | Unit-test override validation. |
| desktop/test/package-engine.test.js | Regression-test package verifier path acceptance. |

## Shared interfaces

~~~js
// desktop/build/macos-signing.js
function parseCodeSigningIdentities(output) {}
function selectLocalAppleIdentity(identities) {}
function shouldDelegateSigning(environment) {}
function classifyMacSignature(codesignDetails) {}

// desktop/lib/credential-store.js
function hasStoredPassword(filePath, platform = process.platform) {}

// desktop/lib/app-data-dir.js
function resolveUserDataOverride(rawValue) {}
// null for missing/empty; absolute normalized path; throws for relative values.
~~~

### Task 1: Add failing unit tests for signing and non-decrypting credential state

**Files:**
- Create: desktop/test/macos-signing.test.js
- Create: desktop/test/credential-store.test.js
- Modify: desktop/test/package-engine.test.js

**Consumes:** Existing afterPack engine helpers and credential-store API.

**Produces:** Tests that distinguish a stable Apple identity from ad-hoc signing and prove password presence does not call safeStorage.

- [ ] **Step 1: Write the signing-policy tests**

~~~js
const identities = parseCodeSigningIdentities(
  '  1) DEVHASH "Apple Development: Example (TEAM)"\n'
  + '  2) DISTHASH "Developer ID Application: Example (TEAM)"\n'
);
assert.deepEqual(selectLocalAppleIdentity(identities), {
  hash: 'DISTHASH', kind: 'developer-id',
});
assert.equal(shouldDelegateSigning({ CSC_LINK: 'base64-cert' }), true);
assert.equal(shouldDelegateSigning({ CSC_IDENTITY_AUTO_DISCOVERY: 'true' }), true);
assert.equal(shouldDelegateSigning({}), false);
assert.equal(classifyMacSignature('Signature=adhoc\nTeamIdentifier=not set'), 'adhoc');
assert.equal(classifyMacSignature('Authority=Apple Development\nTeamIdentifier=TEAM'), 'apple');
~~~

Also add a package-engine assertion that the verifier resolver maps
/tmp/hkustgzconnect.app to /tmp/hkustgzconnect.app/Contents/Resources and leaves
/tmp/resources unchanged.

- [ ] **Step 2: Write the password-presence tests**

~~~js
const spyStorage = {
  isEncryptionAvailable: () => { throw new Error('must not query safeStorage'); },
};
assert.equal(hasStoredPassword(missingFile, 'darwin'), false);
fs.writeFileSync(emptyFile, '');
assert.equal(hasStoredPassword(emptyFile, 'darwin'), false);
fs.mkdirSync(directoryPath);
assert.equal(hasStoredPassword(directoryPath, 'darwin'), false);
fs.writeFileSync(privateFile, Buffer.from([1]));
fs.chmodSync(privateFile, 0o600);
assert.equal(hasStoredPassword(privateFile, 'darwin'), true);
fs.chmodSync(privateFile, 0o644);
assert.equal(hasStoredPassword(privateFile, 'darwin'), false);
~~~

The test imports only hasStoredPassword. It does not instantiate or call
safeStorage; a mutation that calls decryptString or accepts an empty/directory
path must fail a behavior assertion.

- [ ] **Step 3: Run the new unit tests and confirm the expected missing-export failures**

Run:

~~~bash
cd desktop
node --test test/macos-signing.test.js test/credential-store.test.js test/package-engine.test.js
~~~

Expected: FAIL because the new pure modules/functions do not exist.

### Task 2: Implement stable local signing and package verification

**Files:**
- Create: desktop/build/macos-signing.js
- Modify: desktop/build/afterPack.js
- Modify: desktop/build/verify-package.js
- Test: desktop/test/macos-signing.test.js
- Test: desktop/test/package-engine.test.js

**Consumes:** Task 1 test fixtures; macOS security/codesign only at package-build time.

**Produces:** Local Apple signing when a certificate is present; supplied release signing remains delegated; package verifier accepts an app path and reports its signature class.

- [ ] **Step 1: Implement pure signing helpers**

~~~js
const PREFERENCE = [
  ['Developer ID Application:', 'developer-id'],
  ['Apple Development:', 'apple-development'],
];

function parseCodeSigningIdentities(output) {
  return String(output || '').split('\n').flatMap((line) => {
    const match = line.match(/^\s*\d+\)\s+([A-F0-9]{6,40})\s+"([^"]+)"/i);
    if (!match) return [];
    const item = PREFERENCE.find(([prefix]) => match[2].startsWith(prefix));
    return item ? [{ hash: match[1], name: match[2], kind: item[1] }] : [];
  });
}

function selectLocalAppleIdentity(identities) {
  for (const kind of ['developer-id', 'apple-development']) {
    const selected = identities.find((identity) => identity.kind === kind);
    if (selected) return selected;
  }
  return null;
}

function shouldDelegateSigning(environment = {}) {
  return Boolean(environment.CSC_LINK) || environment.CSC_IDENTITY_AUTO_DISCOVERY === 'true';
}
~~~

Implement classifyMacSignature by returning apple only when the codesign detail
contains a non-empty TeamIdentifier other than not set; return adhoc for an
explicit adhoc signature; otherwise unknown.

- [ ] **Step 2: Make afterPack select but never persist an identity**

~~~js
function localSigningIdentity() {
  const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return selectLocalAppleIdentity(parseCodeSigningIdentities(output));
}

if (shouldDelegateSigning(process.env)) return;
const identity = process.platform === 'darwin' ? localSigningIdentity() : null;
const signer = identity ? identity.hash : '-';
execFileSync('codesign', ['--force', '--timestamp=none', '--sign', signer, enginePath]);
execFileSync('codesign', ['--force', '--deep', '--timestamp=none', '--sign', signer, appPath]);
~~~

Catch only failure to discover a local identity and use the existing ad-hoc
fallback. Do not catch a codesign failure after an identity was selected:
a package must fail rather than silently downgrade a requested stable identity.

- [ ] **Step 3: Accept .app inputs in the package verifier**

~~~js
function resolveResourcesDirectory(input) {
  const resolved = path.resolve(input);
  return resolved.endsWith('.app')
    ? path.join(resolved, 'Contents', 'Resources')
    : resolved;
}
~~~

Use the resolved Resources directory for all current ASAR/engine checks.
When the input is a macOS app, execute codesign -dvvv, classify its public
diagnostics, and include “signature=<class>” in the success output. Add
--require-apple-signature support; it throws unless classification is apple.

- [ ] **Step 4: Run the signing and package test group**

Run:

~~~bash
cd desktop
node --test test/macos-signing.test.js test/credential-store.test.js test/package-engine.test.js
~~~

Expected: PASS. Tests run entirely from fixtures and temporary files; they do
not invoke security, codesign, or safeStorage.

- [ ] **Step 5: Commit the build/credential foundation**

~~~bash
git add desktop/build/macos-signing.js desktop/build/afterPack.js desktop/build/verify-package.js desktop/lib/credential-store.js desktop/test/macos-signing.test.js desktop/test/credential-store.test.js desktop/test/package-engine.test.js
git commit -m "fix: stabilize macOS credential access"
~~~

### Task 3: Add validated isolated user-data support and remove status decryption

**Files:**
- Create: desktop/lib/app-data-dir.js
- Create: desktop/test/app-data-dir.test.js
- Modify: desktop/main.js
- Test: desktop/test/app-data-dir.test.js
- Test: desktop/test/credential-store.test.js

**Consumes:** hasStoredPassword from Task 2 and the existing app/user-data startup order.

**Produces:** A private absolute path override applied before the application selects settings/credential files; get-state and auto-connect gates no longer decrypt password data.

- [ ] **Step 1: Write the failing override tests**

~~~js
assert.equal(resolveUserDataOverride(undefined), null);
assert.equal(resolveUserDataOverride(''), null);
assert.equal(resolveUserDataOverride('/tmp/hkustgz-test'), '/tmp/hkustgz-test');
assert.throws(
  () => resolveUserDataOverride('relative-test-profile'),
  /HKUSTGZ_USER_DATA_DIR must be an absolute path/,
);
~~~

- [ ] **Step 2: Run the override test and confirm it fails**

Run:

~~~bash
cd desktop
node --test test/app-data-dir.test.js
~~~

Expected: FAIL because app-data-dir does not exist.

- [ ] **Step 3: Implement the pure resolver and wire it before the instance lock**

~~~js
function resolveUserDataOverride(rawValue) {
  if (rawValue == null || String(rawValue).trim() === '') return null;
  const candidate = String(rawValue).trim();
  if (!path.isAbsolute(candidate)) {
    throw new Error('HKUSTGZ_USER_DATA_DIR must be an absolute path');
  }
  return path.resolve(candidate);
}
~~~

In main.js, after importing path/fs/app but before requestSingleInstanceLock():

~~~js
const userDataOverride = resolveUserDataOverride(process.env.HKUSTGZ_USER_DATA_DIR);
if (userDataOverride) app.setPath('userData', userDataOverride);
~~~

Replace hasPassword with hasStoredPassword(CRED, process.platform) for get-state
and startup auto-connect. Compute passwordPresent once in get-state, use that
single value for both hasPassword and loggedIn, and retain loadPassword only
inside connectOnce.

- [ ] **Step 4: Run focused state and override tests**

Run:

~~~bash
cd desktop
node --test test/app-data-dir.test.js test/credential-store.test.js test/settings-store.test.js test/settings-update.test.js
node --check main.js
~~~

Expected: PASS with no access to safeStorage from the new presence checks.

- [ ] **Step 5: Commit the isolated-profile wire-up**

~~~bash
git add desktop/lib/app-data-dir.js desktop/test/app-data-dir.test.js desktop/main.js
git commit -m "fix: isolate app data and avoid status keychain reads"
~~~

### Task 4: Perform complete verification and a stable-signature package build

**Files:**
- Verify: desktop/release/mac-arm64/hkustgzconnect.app

**Consumes:** Tasks 2 and 3.

**Produces:** Fresh evidence that the repaired package is Apple-signed, contains the new code, and starts under an isolated application profile.

- [ ] **Step 1: Run all desktop checks**

Run:

~~~bash
cd desktop
npm test
npm run test:renderer-layout
node --check build/afterPack.js
node --check build/macos-signing.js
node --check build/verify-package.js
node --check lib/app-data-dir.js
node --check main.js
npm audit --audit-level=high
~~~

Expected: all Node tests and Electron layout checks pass, syntax checks are clean, and audit has no high vulnerabilities.

- [ ] **Step 2: Rebuild and enforce stable signing**

Run:

~~~bash
cd desktop
npx electron-builder --mac zip --arm64 --publish never
node build/verify-package.js release/mac-arm64/hkustgzconnect.app --require-apple-signature
codesign --verify --deep --strict --verbose=2 release/mac-arm64/hkustgzconnect.app
codesign -dvvv release/mac-arm64/hkustgzconnect.app 2>&1
~~~

Expected: package verification prints signature=apple and codesign prints a non-empty TeamIdentifier rather than Signature=adhoc.

- [ ] **Step 3: Smoke-test a profile override without credentials**

Create a new absolute temporary directory, launch only the rebuilt package with
HKUSTGZ_USER_DATA_DIR set to it, and inspect only file paths/process arguments:
the app must create settings/log/PAC files below the temporary directory and
must not start a connection without credentials. Close that test process
gracefully, then move the temporary directory to Trash. Do not open, print, or
decrypt any credential file.

- [ ] **Step 4: Report verified behavior and App Store boundary**

Report the selected public signing class, package path, exact test counts, and
that a first post-migration Keychain prompt can be normal. State explicitly
that Apple Distribution/App Sandbox/notarization remain a separate store
submission project.

