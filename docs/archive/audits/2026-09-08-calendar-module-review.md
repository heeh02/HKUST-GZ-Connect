# Calendar module review acceptance

- Status: Historical acceptance; synchronized-source result below; review/CI/release gates pending
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

## Synchronized source acceptance (2026-09-08)

- Dependency: `aeb691a389159a84fe8738448fdc5ee851c63c90` on PR #106.
- Review-branch synchronization: `262a4f2a00c8422c7e2f9256fb50e7c2a89878e9`.
- Verified code tree: `da43cfb040a1ee3e17a8c7f34941af194b99b97f`.

The review working branch incorporated its updated dependency without conflicts or rewriting
public commits. This did not merge either GitHub PR or change main. The category controller and
category E2E are byte-identical to the dependency, including later-page identity, pager focus and
open-dialog preservation. The diff against the new dependency remains the original module seam;
it does not duplicate the category behavior fixes as a new structural change.

Mac Electron category, full control-shell, schedule-navigation, ASAR module loading,
resource-manager, campus-workspace and popup-MFA fixtures all pass on the synchronized source.
The former control-shell 3-versus-5 failure is resolved by the dependency's exact-ID reachability
test and responsive behavior repair. The original failure above remains historical evidence.

5070 Linux full Desktop tests on the exact synchronization commit: 1272 pass / 6 platform skips /
0 fail under umask 022. Native Windows Node contracts: 36 pass; native Windows category and full
control-shell Electron fixtures pass using the same Git archive. Windows still emits GPU-process
exit warnings (34), so hardware acceleration is not certified. Architecture, exact-tree syntax
(473 sources), secret, install-script and governance checks pass.

The working branch is source-verified, but the PR stays a draft pending independent review,
required-check disposition and its base PR. No current Windows/Linux installer, full Windows unit
suite, signed/notarized application, real-school canary or public release is claimed. No Actions
dispatch or installed-app replacement was performed. Reverting only the extraction must preserve
the dependency's repaired category behavior and user data.

## Original extraction rollback

Revert the structural commit on its stated base. No persisted format or user data changes.
Temporary dependency links reuse the existing cache; removing a link does not remove that cache.
The unrelated root checkout and earlier candidates remain unchanged.
