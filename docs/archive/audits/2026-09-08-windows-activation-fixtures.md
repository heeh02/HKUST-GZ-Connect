# Windows activation fixture acceptance

- Status: Historical test-only candidate evidence
- Owner: Desktop/Persistence maintainers
- Verified: 2026-09-08
- Parent: #83 validation follow-up; does not close M5
- Base: `9e1135c05dc21998c66627e25477d4bd799cd5d7`
- Code: `6a2143f5d637f432f376f71ac38b369a5938e1b7`
- Tested code tree: `91ececb5e81ced5c8f529c4dcdd779e7f734e2fd`

## Finding and correction

Four activation-store tests failed on native Windows before reaching their intended assertions.
Their `writeJson` helper created files with POSIX mode 0600, which does not establish a protected
current-user DACL on Windows. The real store correctly rejected them as `GlobalSettings ACL is invalid`.

The fixture now uses the existing `ensureOwnerOnly` boundary and asserts preparation succeeded.
No production permission check, activation logic, persistence schema or dependency was changed.
A new Windows-only negative test recreates the source without hardening, proves mode 0600 is
insufficient, and verifies the production store still rejects that source before activation.

## Evidence

- Native Windows on the designated 5070 host, Node 24.20.0: original suite 1 passed / 4 failed;
  corrected suite 6 passed / 0 failed / 0 skipped, including the real ACL rejection case.
- 5070 WSL/Linux focused suite: 5 passed / 1 Windows-only skip.
- macOS focused suite, Node 24.19.0: 5 passed / 1 Windows-only skip.
- 5070 WSL/Linux full suite under `umask 022`: 1238 passed / 7 platform skips / 0 failed.
- Architecture, install-script allowlist and exact-tree syntax/secret gates passed.
- Candidate test-file SHA-256 matched on Mac, Linux and Windows:
  `c4066bf766a7c89eea08b8c97e1df45afb34184fde5b814e3f3b4bf38c6ac518`.

Focused command, from the corresponding `desktop/` tree:

```sh
node --test test/unit/switching/active-context/active-context-activation-store.test.js
```

The full Linux command was `umask 022; node --test`. An initial SSH invocation inherited umask
0002 and caused eight unrelated profile-registry fixtures to fail on group-writable directories;
the failures disappeared under the standard non-group-writable test environment. Production
registry checks were not relaxed to accommodate that setup error.

## Journal fixture follow-up (2026-09-08)

The same test domain contained one more native Windows false failure: the journal disappearance
test recreated malformed JSON using mode 0600, so it stopped at `journal ACL is invalid` rather
than reaching content validation. Native RED was 5 passed / 1 failed / 2 POSIX-only skips.

The recreated fixture now passes the existing `ensureOwnerOnly` gate first. Assertions separately
verify invalid JSON (`SyntaxError`) and invalid journal schema (`TypeError`), both wrapped as
`journal is invalid`. A native Windows negative test verifies an inherited ACL still blocks parsing;
only after hardening that same synthetic file does the parser error become observable.

- Code follow-up: `7e499ef8751b18a19de9b14204d4a62a0a2396fd` (test-only);
  tested tree `371897631959ebffaf9c93520653b6bc2ce094c1`.
- Mac Node 24.19.0 and native Windows Node 24.20.0 combined activation/journal suites:
  13 passed / 0 failed / 2 platform-specific skips on each platform.
- 5070 Linux Node 24.20.0 full suite under `umask 022`: 1238 passed / 0 failed / 8 platform skips.
- Architecture, install-script, exact-tree syntax, staged secret and governance gates passed.
- Journal test SHA-256 matched on Mac, Linux and Windows:
  `a7d6d50b6455ba6ef5b34f3a7ab5c8c4b430ccb7d6ec1383be1fcb735e838264`.
- Remote tracked source remained at `6a2143f` plus this exact journal-test replacement; intervening
  local changes were documentation only. No unrelated remote runtime edits were used.

Combined focused command, from `desktop/`:

```sh
node --test test/unit/switching/active-context/active-context-activation-store.test.js test/unit/switching/active-context/active-context-switch-store.test.js
```

## 2026-09-09 revalidation: Git checkout, C bytes and elevated fixture ownership

The earlier results above are historical. Revalidation used native Windows Node 24.20 through the
designated host, not WSL interop, with separate Git worktrees for the current review chain and this PR.
No PR was merged. GitHub direct clone timed out and ended; a read-only local object source and an
incremental bundle were then used. `git bundle verify` validated prerequisite availability, and
checkout/readback established the exact requested HEAD and clean tracked files. The original
Windows checkout was not changed; shared object-source directories must remain available while
these temporary validation clones exist.

On review-chain `3d323e2a0b99b0d89b3bfbf23a1bf21e934c77d5`, exact-index governance now passes.
The proper-Git Windows full run reports **1,412 total / 1,298 passed / 74 failed / 40 skipped**.
The previous source-archive probe reported 75 failures, including the confirmed missing-Git-index
environment error. This removes that harness error; it does not turn the remaining failures into
accepted behavior or prove all are fixture defects. M5 issue #83 owns their separate attribution.

Two additional fixture/reproducibility issues were reproduced and corrected in this PR:

1. `* text=auto` without a C-specific LF rule permits native C checkout as CRLF, even with
   `core.autocrlf=false` when the effective EOL is CRLF. The helper source was 6,658 bytes / 150 CRLF
   sequences versus the committed 6,508 LF bytes; normalized contents matched. `*.c text eol=lf`
   now fixes native-source byte identity. A real temporary Git checkout test was RED before the
   rule and passes for `false/crlf`, `true/crlf` and `input/lf` settings. No global Git setting changed.
2. A temporary-file ownership probe confirmed this elevated session's default owner is
   Administrators, not the current user SID. The old fixture's `ensureOwnerOnly` therefore correctly
   refused to tighten it. These test-owned, newly created synthetic files now use the existing
   Windows **creation** protection API; POSIX fixtures retain `ensureOwnerOnly`. Production ownership,
   DACL, symlink and source-authority checks are unchanged. Do not copy this fixture initialization
   into a production existing-file read/migration path to seize foreign-owned material.

Revalidation source: `095a5eb18cb50e03b874439547ff9e21461e2a46`; C EOL regression first added at
`df9e9e0c62ff702fc4fb022d14ac4d96ba09eddd`. On native Windows the earlier fixture version failed
eight preparation assertions; the corrected combined activation/journal/C-checkout suite passed
**14 / 0 failures / 2 POSIX-only skips**. Mac Node 24.19 passed **14 / 2 Windows-only skips**.
Linux Node 24.20 full suite passed **1,239 / 8 skips / 0 failures** under `umask 022`.
The inherited-ACL negative tests still reject before activation/parsing; malformed JSON/schema
tests still assert their distinct causes after correct fixture preparation.

The fixed PR's native C checkout SHA-256 matches its committed source and the verified helper's
source: `9341aba8971b5b45b73adad9a7eb48c505559214d4f14ad5b1d3ae9f6d0e8af8`.
The reused Windows test helper reported `ec-private-file 1`, SHA-256
`43448327e29d9054cdd65d2c822d216d880de922a97c72e71d17e15c4b0f5d9c`.
The current review-chain baseline built its own helper before the full run because its raw C
checkout was CRLF. Do not conflate a Git blob, working-tree bytes and binary identity.

The two activation/journal test files and their persistence/switching/storage/profile production
domains are unchanged between the current review chain and the main baseline, apart from this
separate proposed fixture repair. The five corresponding baseline failure locations are covered
by this passing scoped run; no combined full-suite reduction is claimed without an authorized
integration and rerun. No new Windows full-suite, application, installer, live-school, release,
transfer, protection or Actions claim follows from these scoped results.

## Rollback boundary

This corrects one test domain, not the entire Windows suite. Other Windows fixture portability
failures remain separately tracked. No full Windows green-suite, package, live-school or new release
claim is made. No application data or credentials were read; all modified files were synthetic
temporary fixtures. GUI and package reruns are omitted because production runtime files are unchanged.

Reverting the test commit restores the old fixture setup without affecting application behavior
or persisted user data. No GitHub protection, required status name or release configuration changes
are part of this candidate.
