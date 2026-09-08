# Native Browser downloads and context retirement

- Status: Proposed behavior repair; not a released capability claim
- Owner: Desktop / Browser maintainers, related to issue #80
- Last verified: 2026-09-08
- Structural base: `6ec66aae5c24e697c9c930da6268c1199131ee9a`
- Tested runtime: `baf4814bb5717dec17b47360237c2e9a083e5216`
- Applies to: Browser download owner, manager disposal and synthetic download acceptance

## Reproduction and behavior

The old algorithm waited for a custom save dialog before attaching native completion callbacks.
The Mac native regression reproduced a completed file with the owner still reporting `downloading`.
This is stronger evidence than the previously passing EventEmitter fixture. The test failed with
`owner missed the real native completion` before the behavior repair.

The owner now synchronously configures Electron's native picker with `setSaveDialogOptions` and
registers item events inside `will-download`, without awaiting a second save dialog. This follows
the [Electron DownloadItem contract](https://www.electronjs.org/docs/latest/api/download-item).
Completion snapshots the native selected path before awaiting the explicit reveal-in-folder prompt.
Native cancellation clears only that item's visible progress, silently; it cannot erase a newer
download's presentation. Unknown lengths remain unknown, and percentages remain bounded.

The owner has an idempotent retirement boundary. It detaches item callbacks, clears presentation,
and schedules exactly one cancellation per active item after the native observer unwinds. Retired
Sessions keep a deny-only listener without retaining their old owner. A new owner for that Session
replaces the old binding. Stale callbacks cannot report progress/errors or reveal a completed path.

Manager disposal retires downloads immediately. Context-switch closure retires them only after
Browser closure is confirmed; a veto leaves the existing owner intact. A late old-context close
cannot clear the replacement Browser or its portal-session hint. Ordinary window closure is not
treated as manager disposal, but an old download cannot open a completion prompt in a replacement
window. Revealing a file remains an explicit user action, never automatic execution.

The owner is 155 lines, within the 600-line target. CampusBrowser remains 1,804 lines, so M2 is not
complete. Main's direct/transitive dependency caps remain 36/170. No Renderer, credential storage,
Profile schema, routing policy, live-school API or system network setting is changed.

## Exact-source evidence

Run from `desktop/`, reusing existing designated-host dependencies:

| Check | Result |
| --- | --- |
| `node --test 'test/unit/browser/**/*.test.js'`, Mac Node 24.19 | 166 passed |
| Same command, Windows 5070 native RBMS SSH / Node 24.20 | 165 passed, 1 platform skip |
| `node --test`, Linux 5070 Node 24.20 | 1,254 passed, 6 platform skips |
| `node e2e/browser-native-download.js`, native Mac and Windows; Linux under xvfb | complete, cancel and active-transfer retirement passed; child close and fixture deletion confirmed |
| `electron e2e/campus-browser-toolbar.electron.js`, Mac | passed |
| `electron e2e/campus-popup-mfa-safety.electron.js`, Mac | existing synthetic assertions passed |
| Architecture / install-script / governance / exact index secret gates | passed |
| Exact-tree syntax, `938c86395abd8e08a5f474cecac43c5f0d876e82` | 466 files passed |

The native fixture serves only a loopback synthetic payload. A first test listener supplies a
temporary selected destination synchronously, so no OS save dialog opens. It checks actual file
bytes, native options, terminal status, cancellation after partial transfer, empty owner registries,
no post-retirement UI effects and parent-confirmed temporary-directory removal. It uses software
rendering deliberately; this is not GPU or OS file-picker UI acceptance.

The parent fixture helper is byte-identical to PR #111's tested helper. A read-only merge-tree check
of the runtime with PR #111 head `ebd3284584ba998ed93fcc967bcc7997711e2f35` produced conflict-free tree
`d17c3e5bb5ee980f71d748e89a12029534b28a2e`; this is an integration tree, not a GitHub merge or main.
Windows native MFA with that tree confirmed assertions, child close and profile removal. Windows
still emitted the known GPU process exit 34 warning in MFA; hardware acceleration remains unverified.

## Limits, integration and rollback

The native fixture does not automate a real user's OS save-dialog choice. Full Windows unit tests,
Mac x64 hardware, signed packages, long-running performance/soak and live-school checks were not run.
The old Windows MFA child-only harness is not a clean gate by itself; use PR #111's parent runner
when integrating these changes. Synthetic MFA is not proof of live-provider compatibility.

Review the structure-only extraction separately, then this behavior repair. PR #111 is independently
reviewable and its shared helper has no production dependency. Do not import the older backend
candidate chain or overwrite the current Renderer improvements. No release, installed application
replacement, repository transfer or branch-protection change is included.

Rollback reverts this behavior change to the structural base, restoring its old download algorithm
and removing manager retirement wiring; no user data migration is needed. That rollback also restores
the reproduced timing/stale-callback defects, which must remain recorded as unresolved.
