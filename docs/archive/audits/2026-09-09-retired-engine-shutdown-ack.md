# Retired Engine shutdown acknowledgement

- Status: Candidate repair; not installed or released; exact user disconnect still unproven
- Owner: Desktop maintainers, PR #106
- Verified: 2026-09-09
- Source: `9738381d3683154c0fb4580f58eacd00fdf16d47`

## Authorized local investigation

The maintainer reports intermittent disconnects on their own Mac, followed by the cleanup warning;
manual connection restores service. Read-only inspection of the installed 2.0.2 and filtered Engine
diagnostics confirmed a recent successful authenticated connection, but no terminal reason in the
available current/rotated log. No authentication or live connection was initiated. Browser databases,
saved passwords and cookies were not inspected. No personal log contents are retained in this receipt.

Installed ASAR SHA-256: `705d83f90356cf3b1973d723f4d785765cba4adbba53843394d32c5a013baf0c`.
Its EngineConnectionRuntime and stop policy matched the pre-repair candidate. This ties the source
investigation to the actual installed app, but the incomplete log cannot prove the exact incident cause.

## Reproduced defect and repair

Main invalidates serving/UI generation before asking the still-owned child to stop. The old
`EngineConnectionRuntime.feed` rejected every byte once that generation was stale, including the
response to the pending Control v2 shutdown. A synthetic reproduction with the actual runtime and
control registry left shutdown pending after delivering its valid acknowledgement; the same bytes
resolved it without invalidation. Regression tests were RED in three cases, including the actual
request timeout. This is independent from the Windows new-owner-file defect.

Pending control requests now explicitly mark shutdown ownership. The retired runtime feeds only
its captured client's shutdown-drain method: no ordinary query response or Control v3 auth bytes
are dispatched. A response must still match the pending request ID, type and accepted/error schema.
After registry replacement, the closed old client cannot acknowledge the new client's request.
Readiness/serving events and user-state callbacks from retired output remain suppressed.

This avoids dropping a legitimate shutdown acknowledgement. It does not treat receipt of an ack
as successful process cleanup: EngineSupervisor still awaits child close and requires the same
clean exit result. Negative/error replies stay failures. No timeout, stop budget, Rust protocol,
credential schema, generation boundary or system-network setting was relaxed.

## Evidence

- Four regressions: fragmented ack across invalidation, ignored auth/readiness/query output,
  replacement-child isolation and preserved shutdown error rejection.
- Mac Node 24.19 and native 5070 Windows Node 24.20: **40/40** control/runtime/supervisor/Main
  boundary tests passed.
- Mac and 5070 Linux full suites: **1,296 total / 1,285 passed / 11 skips / 0 failures**.
- Architecture, exact-source syntax (471 files), secret, install-script and governance passed.

Focused command from `desktop/`:

```sh
node --test test/unit/connection/engine/retired-engine-shutdown.test.js test/unit/connection/engine/engine-connection-runtime.test.js test/unit/connection/engine/engine-control-client.test.js test/unit/connection/engine/engine-control-suite.test.js test/unit/connection/engine/engine-supervisor.test.js test/main-engine-exit-boundary.test.js
```

These tests use real JS owners with synthetic streams, not a real school/Rust logout. A shutdown
ack does not prove the network disruption's original cause. Native full Windows was not rerun after
this follow-up; the earlier 52-failure snapshot remains historical and unaccepted. A real packaged
stop/resume regression and the maintainer's original disconnect remain to be verified.

## Delivery and rollback

No installed App, process, connection or user login data was changed during investigation. The new
candidate has not been packaged, installed, merged or released; existing 2.0.2 test packages do not
automatically contain it. No Actions build or Organization/protection operation was triggered.
Revert this control-client/suite/runtime commit with its tests to restore the prior behavior; no
persisted-data migration is involved. The Windows owner-record repair remains independently reviewable.
