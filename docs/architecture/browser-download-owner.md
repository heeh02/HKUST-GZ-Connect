# Browser download ownership seam

- Status: Proposed structural seam; checkpoint evidence, not a behavior fix or release
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
The [Electron DownloadItem contract](https://www.electronjs.org/docs/latest/api/download-item#downloaditemsetsavepathpath)
limits save-path and save-dialog configuration to the Session's `will-download` callback.
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

Exact runtime candidate: `b48480934df09b2100dac842ddd87aa2058cb040`.

| Check | Evidence |
| --- | --- |
| Mac Node 24.19, Browser unit command above | 155 passed |
| Windows Node 24.20, same command over RBMS native SSH | 154 passed, 1 platform skip |
| Linux 5070 Node 24.20, `node --test` from Desktop | 1,243 passed, 6 platform skips |
| `node scripts/check-architecture.js` | pass; Main direct/transitive 36/170 unchanged |
| `node scripts/check-install-scripts.js` | pass |
| `node ../.github/scripts/check-repository-governance.js` | pass |
| `node scripts/check-sensitive-patterns.js --staged` | pass on the exact runtime index |
| `node scripts/check-javascript-syntax.js --tree 9a936804b7deb1d9e3ffbe88ea64242040301db2` | 463 files passed |
| Native Electron `e2e/campus-browser-toolbar.electron.js` | Mac and Windows passed |
| Native Electron `e2e/campus-popup-mfa-safety.electron.js` | Mac and Linux/xvfb passed; Windows assertions passed but cleanup failed, NOT a clean E2E pass |

The initial Linux full run lacked `electron`/`@electron/asar` resolution; the rerun used only
`NODE_PATH` pointing to the existing designated-host dependency cache. No dependency was installed.
The initial Windows run launched from WSL interop failed two symlink fixtures with EPERM; rerunning
via verified RBMS administrator SSH resolved those test failures without changing permissions.
Admin group membership alone does not prove the security token of every interop launch.

Windows Electron still emitted GPU process exit 34 warnings. The MFA fixture printed PASS and exited
zero even though its asynchronous profile removal then threw EPERM. Its temporary synthetic profile
was retained for diagnosis; no user browser data was accessed. This harness teardown must become
parent-owned with cleanup failures propagated before claiming complete native acceptance.

No native download timing reproduction, real-school test, performance/soak run, exact package
verification, Mac x64 device test or complete Windows unit run was performed in this phase.
At this structural checkpoint no installed application or release was replaced, no Actions run
was triggered and no PR had yet been opened. Current review status belongs to GitHub metadata;
the dated evidence above is not a live queue snapshot.
Reverting this isolated change restores the original methods and private policy path without a
data migration. Existing UI PRs are not imported into or overwritten by this main-based branch.
