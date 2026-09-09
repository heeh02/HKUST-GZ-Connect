# Integration Center Renderer lifetime

- Status: Proposed behavior repair in PR #120; not merged, installed or released
- Owner: Desktop maintainers, #79 / #81
- Verified: 2026-09-09
- Runtime: `612a9dfb` (full SHA in Git); acceptance: `ea1620c4e9e7510bbe55abba18a251b28c27b424`
- Prerequisite: [Main scoped cancellation](integration-export-intents.md)

The public `create` factory owns document locale/state subscriptions and the controller's terminal
lifetime. The feature host explicitly mounts it beside auth-challenge; the old HTML initializer
and both Integration Center globals are removed. The native controller remains available through
its public entrypoint for injected tests. No private peer import or new global exception is added.

Operation and list revisions reject late results. Local cancellation closes the current dialog
immediately and sends only its validated confirmation handle. A late preparation result can
discard only its own handle; malformed metadata never triggers global cancellation. Confirmations,
refreshes, timer callbacks and translations cannot publish after retirement. Timer/listener removal
is explicit; cleanup errors remain observable. Startup/disposal are idempotent and disposal before
startup is terminal. Profile changes/logouts retire the current preview.

Dialog retirement clears metadata and timers. Delegated action buttons avoid per-render listener
accumulation. The unchanged layout, bilingual descriptions and copy/save-only surfaces remain.
The package verifier now requires all five native integration files. Main composition and Renderer
bootstrap line budgets did not increase; the controller remains below its 250-line ratchet.

## Evidence

- RED: all eight initial lifetime regressions failed before implementation.
- Twelve focused lifetime cases cover stale prepare/cancel/confirm/read, malformed/expired preview,
  modal failure, pre-start retirement, accepted-operation expiry and profile/locale subscriptions.
- Mac Node 24.19 and Linux Node 24.20 full suite at `ea1620c`: **1,427 passed / 6 skips / 0 failed**.
  Two initially stale startup/catalog assertions were updated to the exact four-owner contract;
  no feature permission or production guard was relaxed.
- Native Windows Node 24.20 focused Renderer/host/Main-intent/IPC/Preload tests at runtime source:
  **74 passed / 0 skipped / 0 failed**. Later commits change assertions only.
- Mac and native Windows Renderer ASAR fixtures pass through actual DOM button clicks, not removed
  globals. Pagehide closes an open integration modal, clears rows/metadata, and later state/locale
  events remain inert. Parent confirms Electron exit and fixture cleanup.
- Windows ASAR logged the previously observed GPU exit-code-34 warnings; clean GPU behavior is not
  claimed. Mac resource-manager and control-shell layout suites passed.
- Architecture, exact runtime syntax (519 files), indexed secret, install-script and governance
  gates passed. Shared dependency links do not introduce downloaded dependencies or build outputs.

ASAR APIs are synthetic and HTTP(S) is blocked. This is not actual user export, real-school,
installer/signature, full Windows or Linux Electron acceptance. The earlier separate Windows
full-suite baseline remains unaccepted; no reduction is claimed from this scoped run.

## Remaining scope and rollback

This completes the proposed integration host/controller retirement path, not the whole Renderer
migration, 2.0.2 release or governance goal. Keep this optional modularization stack separate from
the minimal 2.0.2 candidate. Revert native lifecycle/controller, bootstrap, registry, removed bridge,
package requirements and tests together. There is no persisted-data or credential migration.
