# macOS Keychain Access and Test Isolation Design

**Status:** Approved 2026-08-03

## Goal

Stop unnecessary macOS Keychain access prompts during normal UI refreshes and make locally rebuilt HKUST(GZ) Connect packages use a stable Apple signing identity whenever one is available. Ensure future packaged-app UI checks can use an explicit Electron user-data directory instead of accidentally reading the normal application profile.

## Observed root causes

1. The local packaging hook signs every built macOS app ad-hoc when no CI signing variables are present. An ad-hoc signature's code hash changes when the bundle changes. macOS may therefore re-prompt before allowing the rebuilt app to use the same Electron Safe Storage Keychain item.
2. The control renderer's get-state handler calls hasPassword() twice. That helper decrypts the local encrypted password, so a status refresh can call Keychain even though it only needs to decide whether a password file is present.
3. Chromium's --user-data-dir does not change Electron's app.getPath('userData'), where this app keeps settings, encrypted credentials, logs, PAC, and site-credential-vault data. A package test using only that Chromium flag can accidentally start with the ordinary application profile.

No credential bytes, decrypted passwords, or Keychain secret values were inspected during this analysis.

## Design

### 1. Stable signing policy

The macOS packaging hook chooses signing in this order:

1. When release or CI supplies CSC_LINK or explicitly enables CSC_IDENTITY_AUTO_DISCOVERY, leave signing to electron-builder. This preserves a supplied Developer ID Application or Apple Distribution identity and future notarization/App Store workflows.
2. For a local build with no CI signing configuration, find a usable local identity through security find-identity -v -p codesigning, preferring Developer ID Application and then Apple Development.
3. Re-sign the bundled engine first and the app bundle second with that identity. The identity is discovered at build time and is never committed to source.
4. Only if no trusted Apple identity is available, retain the existing ad-hoc fallback so developers can still make a runnable local package.

The build verifier reports the resulting macOS signing class. For local builds with an Apple identity available, verification fails if the final app remains ad-hoc. This prevents a quiet regression back to hash-changing signatures.

A one-time Keychain prompt can still occur after changing from existing ad-hoc signing to a stable identity; it grants the new stable designated requirement access. Subsequent builds signed by the same identity should not require repeated access approval.

### 2. Password-presence state without decryption

Add a small credential-store helper that checks whether cred.bin is an owner-only, non-empty regular file. The helper does not call Electron safeStorage or decrypt anything.

- get-state uses that helper once to set both hasPassword and loggedIn.
- startup auto-connect uses it as the gate, then connectOnce() performs the single required decrypt immediately before authenticating.
- an explicit Connect call likewise decrypts only in connectOnce().

The stored password format, encryption algorithm, and sign-in behavior do not change. A corrupt or inaccessible file still fails closed at connection time with the existing “please fill account and password” behavior.

### 3. Explicit app-profile override for isolated tests

Before resolving DATA, main.js recognizes a private local environment override:

    HKUSTGZ_USER_DATA_DIR=/absolute/test/path

It calls app.setPath('userData', resolvedOverride) before any file constants are constructed. The override must be an absolute path. It is not exposed in the UI, settings, logs, or release documentation.

This makes isolated packaged-app checks store every app-owned file—settings, encrypted credential, logs, PAC, browser sessions, and campus credential vault—under the chosen temporary directory. It does not modify the ordinary user profile.

## Credential write guarantees

- VPN credential writes occur only when the save IPC receives a non-empty password. The write atomically replaces the single cred.bin; it never appends or creates per-build credential files.
- Website credential vault writes occur only after the user chooses Save for a submitted HTTPS form. The vault compares the existing exact-origin username/password and avoids a write when they are identical.
- Neither application startup, UI state refresh, packaging, nor the route manager writes a credential.
- Electron Safe Storage uses a Keychain encryption key; encrypting new payloads reuses that key rather than creating one Keychain entry per saved password.

## App Store boundary

This repair makes the signing flow compatible with future Apple Distribution signing, but it does not claim App Store readiness. A store submission must separately add and review App Sandbox entitlements, network/server permissions, bundled Rust-helper signing, privacy metadata, notarization/distribution configuration, and App Review requirements. The fallback ad-hoc path remains for local development only.

## Verification

- Unit-test Apple identity parsing and signing-policy selection without reading the real Keychain.
- Unit-test password-presence detection for missing, empty, directory, and regular owner-only files without invoking safeStorage.
- Unit-test absolute user-data override resolution.
- Run the full desktop test suite, dedicated renderer layout test, syntax checks, and audit.
- Rebuild macOS arm64, confirm the final codesign output carries the available Apple team identity instead of an ad-hoc signature, and verify the packaged app contains the isolation and credential-presence changes.
- Launch any final package test only with HKUSTGZ_USER_DATA_DIR set to a newly created temporary absolute directory. Check that the ordinary user-data directory is not used or changed.

## Non-goals

- Do not replace Keychain/Electron Safe Storage with self-managed AES.
- Do not read, print, migrate, delete, or upload existing credentials or Keychain entries.
- Do not add cloud sync, credential export, telemetry, or account changes.
- Do not implement App Sandbox or App Store submission in this change.

