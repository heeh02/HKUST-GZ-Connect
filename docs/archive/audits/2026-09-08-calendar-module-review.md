# Calendar module review acceptance

- Status: Historical partial acceptance; not merge-ready or released
- Owner: Desktop Renderer maintainers
- Verified: 2026-09-08
- Scope: Issue #79; structural follow-up to PR #106
- Base: `48140fd189b073af28dc4f6f24430b116ff0a22c`
- Code: `d8c7de9c10e1f44d0e89ec4f6c636ac7130fb313`
- Tested tree: `44f5418f1d68a8169780a852d4fb605cca1a4359`

## Change and isolation

The 582-line global campus-data facade becomes a 472-line controller, 102-line calendar model
and two-line public entrypoint. Both the controller function body and calendar model function
bodies were compared with the base after removing indentation/export syntax: exact parity.
Cache capacity, refresh policy, clear behavior, DOM/CSS, IPC, storage, dependencies and native
code are unchanged. The application imports this feature instead of depending on a Window export.

This contribution intentionally excludes the separate lifecycle, calendar-view extraction,
shared feature registry, locale and category behavior candidates. It is stacked on PR #106,
not a replacement release branch and not proof that M1 is complete.

## Actual verification

- Mac focused module/cache/calendar/Renderer/syntax contract tests: 36 passed.
- Native Windows Node 24.20.0 on the designated 5070 host: the same 36 passed, 0 skipped.
  This run used the RBMS Windows SSH entrypoint, not a simulated Windows platform.
- 5070 Linux Node 24.20.0 full Desktop suite under umask 022: 1272 passed, 6 platform skips,
  0 failures. Isolated Git checkout matched the exact code commit; Windows used its Git archive.
- Mac Electron schedule navigation: PASS, including dates, cache/refresh, grouped details,
  narrow/wide/zoom, keyboard and minute geometry.
- Mac Electron native-module ASAR loading: PASS, seven days, no legacy campus-data global,
  and exactly one authentication subscription.
- Mac Electron resource-manager, campus-workspace and category-expand layout fixtures: PASS.
- Mac Electron campus-popup MFA credential-safety fixture: PASS.
- Architecture, install-script allowlist, governance, staged secret scan and exact-tree syntax:
  PASS; syntax enumerated 473 .js/.mjs sources.

Focused command from desktop:

```sh
node --test test/unit/renderer/campus-data-module.test.js test/unit/renderer/schedule-cache.test.js test/unit/renderer/schedule-calendar.test.js test/renderer-contract.test.js test/javascript-syntax-gate.test.js
```

## Failing gate and remaining evidence

`electron e2e/control-shell-layout.electron.js` failed on both the unchanged base and this
candidate at the identical first-page personal-category assertion: actual 3, expected 5
(line 554). The fixture still assumes the old deck count while the base already contains
responsive category behavior. Its later checks were not executed in this run. This is observed
baseline debt, not a passing gate; it needs an independently reviewed correction and full rerun
before this candidate is merge-ready. No assertions were weakened here to hide it.

No full Windows unit suite, Windows/Linux Electron layout suite, signed installer, real campus
login, network-mode switch, installed-app replacement or public release was performed.
No GitHub Actions minutes or protection changes were requested. Local/native results do not
substitute for required CI or independent review.

## Rollback

Revert the structural commit on its stated base. No persisted format or user data changes.
Temporary dependency links reuse the existing cache; removing a link does not remove that cache.
The unrelated root checkout and earlier candidates remain unchanged.
