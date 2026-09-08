# Renderer localization ownership

- Status: Proposed review candidate; not merged or installed
- Owner: Desktop / Renderer maintainers
- Verified: 2026-09-08
- Applies to: M1 Renderer localization extraction, stacked after official-favorites lifecycle

## Contract

`desktop/renderer/features/localization/index.mjs` exports `dictionaries`, `resolveLocale`,
`createT` and `applyStatic`. This is a pure feature, not a lifecycle owner to mount in the host.
Main-process localization and the separate Campus Workspace page's local dictionary are unchanged.

Each locale owns eight domain files: common, account, connection, resources, workspace,
control-tower, settings and browser. Add a translated key to the same domain in both locales.
Entries are explicit key/value pairs; composition rejects duplicates within or between files.
Unit tests reject missing/extra language or domain keys. The public lookup retains Chinese
fallback, then the original key; unknown placeholders remain intact. Runtime key parity is not
used to disable fallback behavior. The dictionaries remain mutable for legacy compatibility.

The extraction preserves all 715 effective key/value pairs per language. The old object contained
two `workspace.scheduleToday` declarations per language; its later effective values (`本周` /
`This week`) are preserved exactly, rather than restoring obsolete daily-count wording.

## Transitional startup

`renderer/i18n.js` is a four-line native-module bridge to the existing `window.I18N` consumers.
A unit ratchet caps it at eight lines; do not restore a shared dictionary there. No global name
or legacy-export exception was added. The registered native feature cannot import peer internals.

Both existing HTML entrypoints load the bridge as a module. Their classic dependencies use
canonical `defer="defer"` so immediate school-selector/integration/toolbar initialization does
not run before translations are available. The source parser rejects bare, duplicate, false,
empty and module defer attributes, and continues rejecting async, inline and remote scripts.
This source-policy change requires independent maintainer review; passing tests are not approval.

This is not the final M1 startup architecture: the remaining legacy initialization still has
HTML-order coupling. As each owner moves behind an explicit lifecycle contract, inject the public
translator and retire the facade and deferred legacy tags. Do not count this extraction as
completion of Issue #79, or disguise the remaining work by adding no-op host entries.

## Validation and rollback

The ASAR fixture checks both launch languages, school/integration initialization, one MFA listener,
calendar/favorites startup and retirement, and browser chrome startup/live language switching.
It blocks HTTP(S), uses synthetic data and a separate profile, and its Node parent verifies
Electron exit before retiring fixture files. It is asset/startup evidence, not a full installer
or live-school test. Run locale units, source-policy units, the Desktop suite, architecture,
syntax, secrets, control-shell layout and browser-toolbar native tests for this boundary.

Rollback reverts the locale files, bridge, matching HTML loading declarations and policy/tests
together. No persisted schema, account, session, credentials, routes or Engine source changes.

## Review evidence

- Base: `cc41fb44dfb6b961f917915821a3cc8a9c1d30e1` (official-favorites lifecycle, PR #115).
- Runtime source: `de0c10abeb7999da4751e5696e67b4d84f1d4fa6`.
- Acceptance source: `abdcbcf30db6038b6e3ae83968b8d4dd79fa8311`; the intervening commit only updates
  old source-string tests to use the strict script inventory and retain the same ordering assertions.
- One-off comparison against the base: all 715 zh/en values and all zh/en/unknown-locale translator
  outputs matched, including representative interpolation variables. No copy rewrite is intended.
- Mac Node 24.19: locale/source-policy suite 46 passed; updated Renderer contract 17 passed.
- 5070 Linux Node 24.20: `node --test` 1,360 passed / 6 platform skips, zero failures. The initial
  run had 5 legacy exact-tag failures after adding defer; no product assertion was removed.
- 5070 Windows Node 24.20: locale, HTML source and Renderer contract tests 38 passed.
- `node e2e/renderer-module-asar.js`: Mac, native Windows and Linux/Xvfb passed both languages,
  with confirmed child exit and temporary-profile cleanup. Windows still emitted the known GPU
  process exit-code 34 warning; it is not resolved by this change.
- Mac native `control-shell-layout`, `resource-manager-layout`, `campus-workspace-layout` and
  `campus-browser-toolbar` Electron fixtures passed. Toolbar's intentional port-1 failure is synthetic.
- Architecture, 508-file exact-tree JavaScript syntax, staged-secret, install-script and repository
  governance gates passed. Mac used Node 24.19; heavy full-suite work ran on 5070.

No full Windows Desktop suite, installer rebuild, real-school/MFA canary, public release, GitHub
merge, Organization transfer or protection change is claimed. The installed Mac archive remained
`705d83f90356cf3b1973d723f4d785765cba4adbba53843394d32c5a013baf0c`; this proposal is not deployed.
