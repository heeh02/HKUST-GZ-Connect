# Integration export intents and effect-boundary validation

- Status: Proposed Main behavior repair; Windows acceptance incomplete; not merged or deployed
- Owner: Desktop / integration maintainers, issues #79 and #81
- Verified: 2026-09-09
- Base: PR #119, `f520db3acfc83ead950431ff36445bbc61104639`
- Tested source: `e94c642539c99d1bdbf428c18d85cd45ed87453a`

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

Windows is **not accepted** for this unit. Native RBMS SSH initially worked, but a fresh helper
build for the isolated source checkout failed with `Visual C++ environment initialization failed`, before the tests started.
Read-only discovery found the existing Build Tools installation; a process-local environment retry
could not connect to the Windows SSH endpoint. A second bounded hostname probe also timed out,
while WSL remained reachable. No compiler installation, system setting, network change, host restart
or privilege change was attempted. No test process was started by either timed-out SSH attempt.
Resume native helper/test verification when direct Windows access is restored; Linux results are
not a substitute. Full Windows, installer/signature, live-school and actual user-export acceptance
remain absent. No Actions build, installed-App replacement, merge, release or transfer is claimed.

## Remaining work and rollback

The [Renderer integration owner](renderer-integration-center.md) still needs explicit startup,
terminal disposal and async publication fences. In particular, an obsolete UI must not issue a
late unscoped cancel against another operation. This Main repair is a prerequisite, not completion
of the whole Integration Center lifecycle or issue #79.

Revert runtime/coordinator/transaction changes and their tests together. Internal coordinator
callers then return to the prior guard signature. No persisted-data migration is involved. The
separate Renderer structural PR can remain; unchanged user sessions and installed packages need
no rollback for this uninstalled candidate.
