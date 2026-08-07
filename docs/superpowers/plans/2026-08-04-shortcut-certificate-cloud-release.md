# Shortcut Certificate and Cloud Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save and reopen a pasted campus URL with one action, explicitly pin a self-signed HTTPS certificate for only that exact origin, and release only cloud-built DMGs and EXEs.

**Architecture:** The dashboard renderer remains unprivileged and sends shortcut mutations through the existing preload IPC. A new main-process certificate trust store holds bounded exact-origin SHA-256 leaf pins and is consulted only for Campus Browser main-frame certificate errors. Release configuration removes every ZIP and checksum artifact path, making GitHub Actions fail rather than publish a fallback format.

**Tech Stack:** Electron 43 / CommonJS, Node.js native test runner, owner-only JSON files, GitHub Actions, electron-builder, Rust engine unchanged.

## Global Constraints

- Do not modify TLS heartbeat or any Rust transport code in this work.
- Do not change system DNS, routing, proxy, keychain, or the macOS trust store.
- Certificate exceptions require exact HTTPS origin, exact SHA-256 DER fingerprint, a Campus Browser main frame, and a native user confirmation.
- A hostname, wildcard, IP range, or previous certificate alone must never grant trust.
- Shortcut and certificate records stay local, bounded, atomically written, and owner-only; do not add sync, export, or import.
- GitHub Actions produces only `*.dmg` for macOS and `*.exe` for Windows. It must not upload or attach ZIP, TXT, or blockmap release assets.
- A cloud package may be Developer-ID-signed only when repository secrets provide that identity; otherwise release notes must say it is ad-hoc-signed.

---

### Task 1: Make pasted URLs saveable and immediately usable

**Files:**
- Modify: `desktop/renderer/index.html:71-90,190-219`
- Modify: `desktop/renderer/app.js:184-306`
- Modify: `desktop/renderer/styles.css:120-155,216-245`
- Modify: `desktop/e2e/resource-manager-layout-preload.js:3-58`
- Modify: `desktop/e2e/resource-manager-layout.electron.js:23-106`

**Interfaces:**
- Consumes: `window.api.saveResource({ id?, name, url, description, route? }) -> Promise<{ ok, resource?, resources, error? }>`.
- Consumes: `window.api.openCampusBrowser({ url, route }) -> Promise<{ ok, error? }>`.
- Produces: `suggestResourceName(rawUrl) -> string` in the renderer and `addAndOpenCampusResource() -> Promise<void>`.
- Produces: a `#quickAddCampus` dashboard button and `#resourceSaved` status region.

- [ ] **Step 1: Expand the Electron workflow test before changing renderer code**

Update the preload fixture so `saveResource` appends the request as a custom
resource and returns it, while `openCampusBrowser` records its last request.
Add a test sequence that opens the manager, leaves the name empty, enters
`103.189.154.10:4433`, blurs the URL, submits, and asserts that the generated
name is `103.189.154.10:4433`, the custom row appears once, and the success
region is populated. Add a second sequence that enters the same host-and-port
URL in the dashboard, clicks `#quickAddCampus`, and asserts the saved resource
is opened with its returned `campus` route.

```js
assert.equal(view.generatedName, '103.189.154.10:4433');
assert.match(view.savedRowText, /103\.189\.154\.10:4433/);
assert.match(view.savedMessage, /已添加/);
assert.deepEqual(view.openedRequest, {
  url: 'https://103.189.154.10:4433/', route: 'campus',
});
```

- [ ] **Step 2: Run the renderer workflow test and verify the new assertions fail**

Run: `cd desktop && npm run test:renderer-layout`

Expected: FAIL because the dashboard add control, automatic-name behavior, or
save success region does not exist yet.

- [ ] **Step 3: Add the dashboard and manager affordances**

In `index.html`, add an `id="quickAddCampus"` button next to the existing
open action and a non-HTML status node `id="quickAddErr"`. Add an
`aria-live="polite"` `id="resourceSaved"` node in the resource manager.
Use existing button classes plus a small action-row style so the controls keep
their compact-window layout. Change the manager name label to state that it is
automatically generated when left blank; preserve a normal editable input.

- [ ] **Step 4: Implement renderer behavior without bypassing main-process validation**

Add browser-safe `suggestResourceName(rawUrl)` that trims input, adds an HTTPS
scheme only for parsing, returns `new URL(value).host`, and returns an empty
string for invalid URLs or non-HTTP(S) schemes. On `#resourceUrl` blur, fill
`#resourceName` only when it is empty. Refactor the existing submit handler
into an awaited helper with `try/catch`; send the current form data to
`window.api.saveResource`, replace `campusResources` from the returned data,
rerender both lists, clear the form, and set `#resourceSaved` to
`已添加“<name>”` using `textContent`.

Implement `addAndOpenCampusResource()` as follows:

```js
const rawUrl = $('campusUrl').value;
const name = suggestResourceName(rawUrl);
const saved = await window.api.saveResource({ name, url: rawUrl, description: '' });
if (!saved?.ok) throw new Error(saved?.error || '添加常用网站失败');
campusResources = saved.resources || campusResources;
renderResources();
return window.api.openCampusBrowser({
  url: saved.resource.url,
  route: saved.resource.route,
});
```

Do not send `route` to `saveResource`; the existing main process is the single
source of reviewed default routing. Share the busy-state UI with the existing
open action, surface caught errors in `#quickAddErr`, and do not add a direct
filesystem path to the renderer.

- [ ] **Step 5: Run the renderer workflow test and full desktop suite**

Run:

```bash
cd desktop
npm run test:renderer-layout
npm test
```

Expected: the renderer workflow prints `PASS` and all Node tests pass.

- [ ] **Step 6: Commit the shortcut workflow**

```bash
git add desktop/renderer/index.html desktop/renderer/app.js desktop/renderer/styles.css \
  desktop/e2e/resource-manager-layout-preload.js desktop/e2e/resource-manager-layout.electron.js
git commit -m "feat: save and open custom campus shortcuts"
```

### Task 2: Add exact-origin certificate pinning for Campus Browser

**Files:**
- Create: `desktop/lib/campus-certificate-trust.js`
- Create: `desktop/test/campus-certificate-trust.test.js`
- Modify: `desktop/main.js:49-100,493-508,649-651`
- Modify: `desktop/lib/campus-browser.js:88-130,430-460`
- Modify: `desktop/test/campus-browser.test.js`
- Modify: `desktop/build/verify-package.js`
- Modify: `desktop/test/package-engine.test.js`

**Interfaces:**
- Produces: `certificateFingerprint(pem) -> string`, `normalizeHttpsOrigin(url) -> string`,
  `loadCertificateTrust(file) -> TrustRecord[]`, `saveCertificateTrust(file, records)`,
  `findTrustedCertificate(records, origin, fingerprint) -> boolean`, and
  `upsertTrustedCertificate(records, { origin, fingerprint }) -> TrustRecord[]`.
- Produces: `CampusBrowser.ownsWebContents(webContents) -> boolean` and
  `CampusBrowser.handleCertificateError({ url, error, certificate, isMainFrame, callback }) -> Promise<void>`.
- Consumes: Electron `app` `certificate-error` event, `dialog.showMessageBox`,
  and the owner-only JSON persistence helpers already used by settings.

- [ ] **Step 1: Write failing trust-store tests**

Create tests using a small PEM fixture with base64 DER bytes. Verify:

```js
assert.equal(normalizeHttpsOrigin('https://103.189.154.10:4433/path'),
  'https://103.189.154.10:4433');
assert.throws(() => normalizeHttpsOrigin('http://103.189.154.10:4433'), /HTTPS/);
assert.equal(findTrustedCertificate(records, origin, fingerprint), true);
assert.equal(findTrustedCertificate(records, origin, changedFingerprint), false);
assert.equal(findTrustedCertificate(records, 'https://sub.example.test', fingerprint), false);
assert.equal(fs.statSync(file).mode & 0o777, 0o600);
```

Also add a `CampusBrowser` fixture test where an owned main frame receives a
certificate error, the fake dialog returns cancellation, and the callback gets
`false` without any trust-store write.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
cd desktop
node --test test/campus-certificate-trust.test.js test/campus-browser.test.js
```

Expected: FAIL because the certificate trust module and Campus Browser methods
do not exist.

- [ ] **Step 3: Implement bounded, owner-only certificate records**

Create `campus-certificate-trust.js` with a maximum of 32 records. Parse PEM by
removing only PEM framing and whitespace, decode its DER bytes, and compute a
lowercase SHA-256 hex fingerprint. Accept only origins returned by `new URL`
whose protocol is `https:` and whose username/password are empty. Validate a
64-character lowercase hexadecimal fingerprint. Normalize, de-duplicate by
origin, atomically save through a sibling temporary file with mode `0600`, and
apply `ensureOwnerOnly` after rename. Do not retain PEM, subject, issuer,
password, cookies, or any wildcard record.

- [ ] **Step 4: Integrate an explicit native confirmation path**

Add `CAMPUS_CERTIFICATE_TRUST` beneath Electron user data and include it in the
existing private-file permission initialization. Inject a small adapter into
`CampusBrowser` that loads, checks, and saves trust records; it must not expose
paths to preload or renderer code.

Add `ownsWebContents` by identity-checking the browser's tab
`webContents`. Add `handleCertificateError` that rejects non-main-frame or
non-HTTPS navigations, computes the DER SHA-256 fingerprint, accepts an exact
existing pin, otherwise displays a native dialog with origin, Chromium error,
subject, issuer, validity dates, and fingerprint. Only a response of zero
persists the exact origin/pin then calls `callback(true)`; every other path
calls `callback(false)`.

In `main.js`, attach one `app.on('certificate-error', ...)` listener. Call
`event.preventDefault()` only after `campusBrowser?.ownsWebContents(webContents)`
returns true, then delegate the async decision. Leave all other app and
browser-window certificate errors to Chromium's default behavior.

- [ ] **Step 5: Extend the package gate and run certificate-focused tests**

Require the packaged main script to contain the controlled
`certificate-error` ownership check and the packaged library to contain the
certificate trust module. Add the corresponding negative test to
`package-engine.test.js`.

Run:

```bash
cd desktop
node --test test/campus-certificate-trust.test.js test/campus-browser.test.js test/package-engine.test.js
```

Expected: all focused tests pass, including cancellation, exact origin, and
changed fingerprint cases.

- [ ] **Step 6: Run the full desktop suite and commit**

Run: `cd desktop && npm test && npm run test:renderer-layout`

Commit:

```bash
git add desktop/lib/campus-certificate-trust.js desktop/test/campus-certificate-trust.test.js \
  desktop/main.js desktop/lib/campus-browser.js desktop/test/campus-browser.test.js \
  desktop/build/verify-package.js desktop/test/package-engine.test.js
git commit -m "feat: pin explicitly trusted campus certificates"
```

### Task 3: Make cloud releases DMG-and-EXE only

**Files:**
- Modify: `desktop/package.json:27-66`
- Modify: `.github/workflows/build.yml:88-199`
- Create: `desktop/test/release-assets.test.js`
- Modify: `desktop/package-lock.json`

**Interfaces:**
- Produces: electron-builder configuration whose macOS targets are two DMGs and
  whose Windows target remains the x64 NSIS EXE.
- Produces: a tag workflow artifact/release file set matching only
  `desktop/release/*.dmg` and `desktop/release/*.exe`.
- Consumes: optional `MAC_CSC_LINK` / notarization secrets; their absence uses
  the workflow's explicit cloud ad-hoc signing mode.

- [ ] **Step 1: Write a failing release-asset configuration test**

Create a Node test that reads `package.json` and `build.yml` as text. Assert:

```js
assert.deepEqual(packageJson.build.mac.target, [
  { target: 'dmg', arch: ['arm64', 'x64'] },
]);
assert.doesNotMatch(workflow, /desktop\/release\/\*\.zip/);
assert.doesNotMatch(workflow, /SHA256SUMS/);
assert.match(workflow, /desktop\/release\/\*\.dmg/);
assert.match(workflow, /desktop\/release\/\*\.exe/);
assert.match(workflow, /no macOS DMG was produced/);
```

- [ ] **Step 2: Run the new configuration test and verify it fails**

Run: `cd desktop && node --test test/release-assets.test.js`

Expected: FAIL because ZIP targets and checksum paths remain in the current
configuration.

- [ ] **Step 3: Remove fallback artifact formats from package and workflow**

Remove the macOS ZIP target from `package.json`. In the macOS workflow invoke
only `npx electron-builder --mac dmg --arm64 --x64`; retain the bounded three
attempt retry but explicitly exit nonzero after all retries and print
`no macOS DMG was produced`. Delete checksum generation. In both artifact and
release upload lists retain only `desktop/release/*.dmg` and
`desktop/release/*.exe`. Do not retain `.blockmap`, ZIP, or TXT globs.

- [ ] **Step 4: Run release configuration and full desktop checks**

Run:

```bash
cd desktop
node --test test/release-assets.test.js
npm test
npm run test:renderer-layout
npm audit --audit-level=high
```

Expected: all commands exit zero and the audit reports no high-severity
dependency vulnerability.

- [ ] **Step 5: Run engine validation and commit release configuration**

Run:

```bash
cd independent
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked --release --bin ec-engine
```

Commit:

```bash
git add desktop/package.json desktop/package-lock.json desktop/test/release-assets.test.js .github/workflows/build.yml
git commit -m "build: publish only dmg and exe artifacts"
```

### Task 4: Version, cloud build, and release verification

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/package-lock.json`
- Modify: `README.md` only if its download instructions mention ZIP or checksum TXT files.

**Interfaces:**
- Produces: release version `1.0.6` and annotated tag `v1.0.6`.
- Produces: GitHub Release notes that name the actual cloud signing result,
  describe shortcut and certificate-pinning behavior, and list only two DMGs
  and one EXE.

- [ ] **Step 1: Bump the version and verify source/package consistency**

Set both package files to `1.0.6`. If README refers to ZIP or checksum assets,
replace those references with the ARM DMG, Intel DMG, and Windows x64 EXE names.

Run:

```bash
cd desktop
node -p "require('./package.json').version"
npm test
```

Expected: version prints `1.0.6`; all tests pass.

- [ ] **Step 2: Commit, push, and tag only after fresh full verification**

Run the exact Task 3 desktop and engine commands again, inspect `git status`,
and stage only files owned by these tasks. Do not stage existing user README
edits, old release directories, or unrelated design/plan documents.

```bash
git add desktop/package.json desktop/package-lock.json README.md
git commit -m "release: prepare hkustgzconnect 1.0.6"
git push origin HEAD:main
git tag -a v1.0.6 -m "hkustgzconnect 1.0.6"
git push origin refs/tags/v1.0.6
```

- [ ] **Step 3: Verify the cloud workflow and release assets before announcing**

Wait for both macOS and Windows jobs in the `v1.0.6` workflow to finish. Read
the macOS signing log: if it states Developer ID signing and notarization, say
so; if it states ad-hoc signing, say that installation requires the normal
macOS right-click → Open path. Do not mention a local personal Apple
Development signature for a cloud artifact.

Use `gh release view v1.0.6 --json assets,body,url` and verify the asset list
is exactly:

```text
hkustgzconnect-1.0.6-mac-arm64.dmg
hkustgzconnect-1.0.6-mac-x64.dmg
hkustgzconnect-1.0.6-win-x64.exe
```

Delete any unexpected ZIP, TXT, or blockmap release asset before publishing the
completion report. Set Chinese release notes describing the explicit
certificate-pinning prompt, local-only shortcuts, tunnel/direct route behavior,
and actual signing mode.
