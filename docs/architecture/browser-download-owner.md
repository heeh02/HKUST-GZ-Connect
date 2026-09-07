# Browser download ownership seam

- Status: Local structural review candidate; not a download behavior fix or release
- Owner: Desktop / Browser maintainers, issue #80
- Last verified: 2026-09-08
- Base: `main@9e1135c05dc21998c66627e25477d4bd799cd5d7`

## Scope

`desktop/lib/browser/downloads/download-controller.js` owns the existing download session
registration, DownloadItem callbacks and bounded toolbar presentation. CampusBrowser injects
current dialog/window/translator/error/reveal effects and delegates through its existing methods
and read-only diagnostic getters. Routing, tab lifetime, MFA, storage and Renderer are unchanged.
The owner has no filesystem, credential, routing or Electron import. Revealing a saved file is
still gated by the existing explicit completion-prompt choice; it does not execute the file.

The private open-request normalization functions move unchanged into their sole production
consumer's existing public entrypoint, `campus-browser-manager.js`. Removing that private leaf
funds the download owner within the unchanged Main transitive cap of 170. No dependency was
hidden from the architecture graph, no package dependency or workflow was added.

CampusBrowser shrinks from 1,854 to 1,804 lines; the download owner is 90 lines. This is one
independently reviewable seam, not completion of the 600-line Browser ownership target.

## Deliberately unresolved behavior

The legacy algorithm awaits `showSaveDialog` before `DownloadItem.setSavePath`. This extraction
preserves that algorithm; EventEmitter tests do not prove Electron's native callback timing.
Native save-picker configuration must be validated and corrected as a separate behavior change.
Session listener retirement and deferred completion effects after a context switch likewise
remain separate lifecycle work. Do not claim that this seam fixes either issue.

Native follow-up must use a loopback synthetic download, an isolated temporary destination and
exact-source native Electron evidence on Mac, Windows 5070 and Linux 5070. It must not use a live
school endpoint, user credentials or the user's Downloads directory.

## Verification and rollback

The focused Browser test command is `node --test 'test/unit/browser/**/*.test.js'` from Desktop.
Tests cover existing Browser behavior, session deduplication, presentation bounds, cancellation,
explicit reveal choice and call-time injected UI effects. A 1,804-line Browser ratchet prevents
this extraction being silently absorbed back into the composition file.

Local focused tests and architecture gate pass. Full native validation remains to be recorded
before this candidate is offered for review. No installed application or release is replaced.
Reverting this isolated change restores the original methods and private policy path without a
data migration. Existing UI PRs are not imported into or overwritten by this main-based branch.
