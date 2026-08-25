# P8 WebResource implementation review

## Scope

This review covers the ordinary-user WebResource upgrade on `codex/2.0-p8-web-resources`. It changes no Gateway
authentication, Modern L3, DNS, SOCKS/HTTP frontend or External Tool Integration provider.

## Delivered boundaries

- The reviewed resource asset is an exact manifest-bound versioned document.
- Runtime WebResource values carry version, bounded locale fallbacks, canonical URL, explicit route, closed
  category, bounded keywords, packaged-icon placeholder and reviewed provenance.
- Stored-resource open IPC accepts only a resource ID. Main re-resolves the current active library and route.
- The P8 library presents both bounded sources (32 reviewed plus 32 local) without the old 32-item shelf cap.
- Direct resources open while disconnected. The shared Browser request boundary pauses a later Campus redirect,
  starts the current Engine generation on demand, then resumes the original request without replay.
- Favorites and recent successful opens are separate owner-only, link-resistant, bounded Workspace documents.
  They contain only resource IDs and timestamps and are never uploaded.
- Search, categories, favorites, recents and custom websites remain local UI behavior.
- A stale Profile context fails before opening; an in-flight open is serialized through the active-context barrier.

## Explicit exclusions

No SSH/HPC/TCP/Jupyter/database/file/Remote Desktop/WebVPN resource type, launcher, `LaunchHandle`, generic broker
or authenticated server catalogue was added.

## Verification

- Desktop unit/contract suite: 992 tests, 991 passed, one Windows-only skip, zero failures.
- Architecture Gate: 380 JavaScript files, 758 edges, zero cycles, zero unresolved production imports and zero
  root debt; Main retains 35 direct dependencies and one composition export.
- Exact-tree JavaScript syntax, tracked-secret, install-script and `npm audit` gates passed; zero vulnerabilities.
- Every named Electron/desktop scenario passed, including Direct-without-Engine Main integration, Engine
  lifecycle, Profile switching, migration, ASAR, layout, routing restart, MFA safety and strict proxy auth.
- Campus Browser 20-tab switch p95: 1.0 ms. The 30-cycle soak left no tab, view, slow-timer or credential-timer
  residue.
- Rust fmt and Clippy `-D warnings` passed. Rust tests: 297 passed, two explicit performance matrices ignored,
  zero failures.
