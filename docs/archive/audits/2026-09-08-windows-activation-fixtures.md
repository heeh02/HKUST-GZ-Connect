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

## Limits and rollback

This corrects one test domain, not the entire Windows suite. Other Windows fixture portability
failures remain separately tracked. No full Windows green-suite, package, live-school or new release
claim is made. No application data or credentials were read; all modified files were synthetic
temporary fixtures. GUI and package reruns are omitted because production runtime files are unchanged.

Reverting the test commit restores the old fixture setup without affecting application behavior
or persisted user data. No GitHub protection, required status name or release configuration changes
are part of this candidate.
