# Integration export intents and effect-boundary validation

- Status: Proposed Main repair; Windows targeted checks passed, repository-wide gate red; not deployed
- Owner: Desktop / integration maintainers, issues #79 and #81
- Verified: 2026-09-09
- Base: PR #119, `f520db3acfc83ead950431ff36445bbc61104639`
- Tested source: `e94c642539c99d1bdbf428c18d85cd45ed87453a`
- Native path-fixture acceptance: `95902b015b1ac8a9d03e0c4813e2c670827d0532` (runtime unchanged)

## Why Main must be repaired before Renderer retirement

The previous runtime captured a context before awaiting a native save target and did not revoke
that continuation on cancel. Its confirmation catch also called global cancellation, which could
erase a newer preview. Finally, the coordinator awaited pre-export preparation without rechecking
authority immediately before clipboard/file output. Eight offline regression cases demonstrated
these failures. Removing a UI dialog alone cannot prevent an already-received Main request.

## Ownership and compatibility

`IntegrationCenterRuntime` now assigns an internal intent to each valid prepare/accepted confirm.
Global cancel advances the intent before clearing pending state. A late target selection cannot
publish or replace a preview; the current binding is re-read after selection and compared with the
immutable initial digest. That existing digest covers Profile/account/workspace, credential,
listener, port and policy revisions. This does not invent a second binding schema.

Confirmation checks its intent before delegating. `GenericExportCoordinator.confirm` requires an
explicit synchronous assertion (void return, failure by throwing); missing, declared-async and
promise-returning checks cannot silently grant authority. The assertion runs before consuming the
handle and again after `beforePerform`, immediately before synchronous clipboard/file commit.
Production supplies it from the runtime's current intent/binding owner; standalone test callers
explicitly provide their stable synthetic assertion.

Internal `cancel(handle)` only clears matching prepared material. Old failure cleanup therefore
cannot erase a newer preview. The existing no-argument global cancellation and public IPC shape
remain unchanged; scoped cancellation is not exposed to Renderer by this unit. Existing invalid
**execute**-handle behavior still fails closed and invalidates prepared material, as its regression
contract requires; this change must not be read as altering that policy.

A failed replacement target selection retains a prior valid preview. A duplicate confirm with no
pending record does not revoke the already-accepted operation. Already-committed clipboard/file
output is not retroactively reported as canceled or rolled back. Preparation effects already run
(for example a private helper sidecar) are not rolled back by this guard. Logical cancellation
does not claim to dismiss the OS save dialog; its late answer becomes inert. The existing cancel
return value still describes whether prepared material was cleared, not native-window closure.

No configuration format, public IPC argument, credential storage schema, routing, Engine or
system-network behavior is changed. Main still owns raw generated content; Renderer sees only
metadata/handles. Executing payloads are zeroed in the existing transaction finally path, including
guard failure after preparation; save regressions observe a nonempty borrowed buffer before testing
zeroization. Confirmation TTL semantics and Renderer lifecycle are not replaced by this repair.

## Evidence

- Mac Node 24.19: 34 runtime/coordinator/transaction/IPC tests passed, including 18 new lifecycle
  and guard cases. Save-success regression writes only a test-owned temporary file; clipboard is
  injected. New cancellation tests use in-memory effects, not a user's destination or clipboard.
- 5070 Linux Node 24.20: full Desktop suite — 1,406 passed / 6 platform skips, zero failures.
- Mac native Renderer ASAR smoke passed. It exercises the unchanged Renderer with synthetic APIs;
  it is not evidence of real Main export or native save-dialog interaction.
- Architecture, install-script, repository-governance and secret gates passed. Exact HEAD syntax
  passed 517 source files. Main dependency/line budgets did not increase.

### Windows follow-up on 2026-09-09

The earlier helper-build failure and SSH outage are historical, not the current targeted-test state.
SSH returned without host/network changes. Initializing the existing `VsDevCmd.bat -arch=x64` in
the test process allowed the fresh native helper build to complete; automatic environment discovery
in the standalone build script was not changed. No compiler installation or persistent environment
change was made. The helper reported `ec-private-file 1`, SHA-256
`43448327e29d9054cdd65d2c822d216d880de922a97c72e71d17e15c4b0f5d9c`.

The first native scoped run passed 33/34; its failing default-path assertion assumed POSIX spelling.
The full-suite probe also found a VS Code fixture supplying noncanonical POSIX paths on Windows.
Both integration fixtures now use native absolute paths, including spaces. Assertions still require
the exact default filename/parent, only one supported save dialog, cancellation rejection, secret
exclusion and generated-payload validation. No production path validator or ACL check was relaxed.

Native Windows Node 24.20 then passed **37/37** runtime, transaction, adapter and IPC tests, including
real owner-only writes in test-owned temporary directories using the compiled helper. Linux was
rerun on the same source: **1,406 passed / 6 skips**; the expanded **37/37** also passed on Mac.
Runtime code remains byte-identical to the
tested `e94c642` implementation; these follow-up commits change fixtures only.

**The repository-wide Windows gate is still not accepted.** An exploratory full run on the final
source archive reported **1,412 tests: 1,297 passed, 75 failed, 40 skipped**. The prior probe before
the second fixture correction had 76 failures. One failure is explicitly a harness limitation:
the archive lacks `.git`, so the exact-index governance test cannot run there. Other failures span
storage/migration, switching, profiles, resources and Engine tests. Some active-context fixtures
overlap existing PR #107; not all failures have been attributed or proven to be production bugs.
No claim that these are all caused by, or unrelated to, PR #120 is made from path comparison alone.
Follow-up belongs to M5 issue #83: use a proper Windows Git checkout, reconcile PR #107, then audit
each remaining fixture/implementation without broad Windows skips or weaker permission checks.

Windows full-suite, full installer/signature, live-school and actual user-export acceptance remain
unproven. Targeted success is not a release approval. No Actions build, installed-App replacement,
merge, release or transfer is claimed.

## Remaining work and rollback

The [Renderer integration owner](renderer-integration-center.md) still needs explicit startup,
terminal disposal and async publication fences. In particular, an obsolete UI must not issue a
late unscoped cancel against another operation. This Main repair is a prerequisite, not completion
of the whole Integration Center lifecycle or issue #79.

Revert runtime/coordinator/transaction changes and their tests together. Internal coordinator
callers then return to the prior guard signature. No persisted-data migration is involved. The
separate Renderer structural PR can remain; unchanged user sessions and installed packages need
no rollback for this uninstalled candidate.
