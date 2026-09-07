# Official favorites native entrypoint acceptance

- Status: Historical source acceptance; draft contribution, not release authority
- Owner: Desktop Renderer maintainers
- Verified: 2026-09-08
- Scope: Issue #79 / M1, second native feature entrypoint
- Base: `40dc7f4d4e733db81a6552cb3209d3ab7ac73ddb` (PR #108)
- Code: `ea3b9a5e0b66ed9b7cb9279a504efdbc6bb4115b`
- Tested tree: `03169349acf5fcc5fd6f35dba99b771becb165a4`

## Change and parity

The 184-line legacy wrapper becomes a 174-line native feature entrypoint. The application imports
the factory and the old HTML script is removed. A direct comparison with the base confirmed the
entire implementation body matches after indentation/export/wrapper normalization. There are no
intended behavior, stylesheet, localization, API, native resource or persistent-data changes.

The module-entrypoint test failed before extraction (missing native entrypoint). It now verifies
the two public exports, absence of the legacy script/factory and bounded module ownership.
Behavior fixtures cover existing and ungrouped placement, bilingual payloads, empty new-group
validation, ordered group/resource/move writes and a failed create that does not publish success.

## Actual evidence

- Mac Node 24.19.0 focused favorite/module/Renderer contracts: 22 passed.
- Native Windows Node 24.20.0 on 5070 via RBMS SSH: the same 22 passed, 0 skipped.
- 5070 Linux full Desktop on the exact code commit under umask 022: 1281 passed,
  6 platform skips, 0 failures. Windows used a fresh Git archive of that code.
- Mac Electron ASAR: both native feature imports load; the favorite chooser opens; no Window
  favorite factory remains; authentication has exactly one subscription.
- Mac Electron full control-shell, category expansion, schedule navigation, resource-manager and
  campus-workspace fixtures pass, retaining narrow/wide, keyboard and reduced-motion coverage.
- Native Windows full control-shell and category fixtures pass. GPU-process warnings (34) remain;
  hardware acceleration is not certified by these checks.
- Architecture, exact-tree syntax (478 sources), staged secret scan, install-script and governance
  checks pass. No architecture budget or required GitHub status name changed.

Focused command from desktop:

```sh
node --test test/official-favorite-dialog.test.js test/unit/renderer/official-favorites-behavior.test.js test/unit/renderer/official-favorites-module.test.js test/renderer-contract.test.js
```

## Limits and rollback

No new lifecycle cancellation/disposal guarantee is claimed. Already-dispatched Main operations,
shared registry/global-export enforcement, full Windows unit tests, Windows ASAR, native installers,
signing and real-school validation remain outside this phase. All data is synthetic; user profiles,
accounts, sessions, credentials and the installed app were not changed.

The parent feature repairs must be preserved when reverting only this extraction. The contribution
remains a draft for independent review and required-check disposition. No Actions dispatch, GitHub
PR merge, tag, release, repository transfer or protection change was performed.
