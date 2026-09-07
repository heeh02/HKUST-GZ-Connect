# Calendar and personal-category local repair

- Status: Historical local acceptance; not a public release
- Owner: Desktop/UI maintainers
- Last verified: 2026-09-07
- Applies to: code `7d296c4563bdc086483f95f30ac520add8054310`, tree `b81b2dda79fd6efbcbfe1442784d8d5b6ae21d11`
- Published base: `main@9e1135c05dc21998c66627e25477d4bd799cd5d7` (2.0.1)

## Delivered locally

- Date picker, previous/next week and return-to-current-week navigation reach an exact-schema
  Main IPC. Only a date and optional boolean refresh flag are accepted; the school endpoint and
  authenticated Session remain Main-owned. Selected-week queries use campus UTC+08 boundaries.
- Week caches are separate, bounded to 12 entries and expire after one day; manual refresh bypasses
  the selected cache. Invalidation or a changed partition/portal rejects late selected-week results.
- The final overview fits occupied hours into 180–300 CSS pixels, without a nested vertical
  scrollbar. Intersecting visual intervals become one full-width counted group instead of thin
  columns. Every original segment remains in its group detail view, with full title/time/location.
  Minimum-sized very short neighboring entries can share a group; the label says arrangements,
  not that every grouped entry is necessarily simultaneous. No inferred deduplication is performed.
- Non-empty personal categories have a header expansion button even below the preview limit.
  A wider dialog shows every resource. Personal header and underline-pager switches and official
  service switches use the same soft transform/opacity function and reduced-motion behavior.
- The earlier tall minute-scale local candidate was superseded after user screenshots demonstrated
  excessive blank space and unreadable concurrent columns. It is not the final design.

## Verification

Node 24.19.0 and Electron 43.2.0, local macOS arm64. Existing runtime/dependency paths were reused.

| Command/check | Result |
| --- | --- |
| `npm test` | 1,254 passed, 6 platform skips, 0 failed |
| `Electron e2e/schedule-navigation.electron.js` | PASS: arbitrary date, adjacent weeks, today, refresh, complete 3-entry group, Escape, narrow/wide/zoom, bounded height and no overlapping text/cards |
| `Electron e2e/category-expand.electron.js` | PASS: 1–2-item categories expand with all rows, Escape, narrow/wide, deck/pager timing and reduced motion |
| `Electron e2e/control-shell-layout.electron.js` | PASS: real control shell and synthetic calendar segments |
| `Electron e2e/resource-manager-layout.electron.js` | PASS |
| Architecture, repository/link governance, install-script checks | PASS |
| Exact-tree JavaScript syntax and secret checks | PASS |
| Package verifier, CPU architecture and deep strict codesign verification | PASS, macOS arm64, ad-hoc |
| Installed ASAR source comparison | Calendar, IPC and category renderer files match the repaired source |

One earlier isolated packaged-launch probe remained alive but needed forced cleanup after its
SIGTERM deadline; it is not counted as a clean-shutdown pass. Normal macOS quit of the installed
App completed before replacement. Non-fatal Electron `task_policy_set` warnings appeared in some
layout fixtures; assertions passed and those fixtures exited zero.

## Installation and boundaries

The final application replaced `/Applications/hkustgzconnect.app` after package verification and
normal quit, with a rollback copy retained during the swap. It was reopened and its installed
process observed. Installed `app.asar` SHA-256:

`fe041d5e1f269ca6d73202af94d7f7d9129ae4f154d08e0b026d6f0342c26448`

Its version remains 2.0.1 **local repair**, not a replacement for the published immutable 2.0.1
artifacts. Rust/native source, Profile assets and build inputs did not change; native arm64 inputs
were reused from the verified 2.0.1 package. Final signing was explicit ad-hoc; a discarded initial
build selected an unrelated local identity and was not installed. No user-data directory, saved
credentials, browser cookies or school authentication was read or migrated by this delivery.

After confirming the final payload and process, this task's old App backups, intermediate release
directory and temporary App output were removed. The original user-owned release evidence and
dependency caches were retained. Rollback can rebuild the preceding local commit or reinstall a
published package without a user-data migration.

Windows/Linux native execution, real school arbitrary-week API responses and post-transfer update
discovery were not tested in this batch. No push, remote merge, new Release, repository transfer,
protection change or live-school canary was performed. The wider governance/modularization goal
remains incomplete.
