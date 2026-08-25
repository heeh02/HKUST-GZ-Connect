# ADR-0010: P3 destination materialization and legacy retirement

- Status: Accepted as a non-activating P3d contract
- Production migration: not enabled by this ADR
- Parent contracts: [`ADR-0008`](0008-p3-receipts-and-vpn-envelope.md),
  [`ADR-0009`](0009-p3-migration-coordinator.md)

## Context

P3c proves migration authority transitions but uses callbacks for destination construction and legacy retirement.
Those callbacks are security boundaries: a generic copy loop could overwrite unrelated data, follow a link or
delete old authority before the destination is complete.

## Decision

### Exact destination map

`profile-workspace-destination-files.js` maps every `DESTINATION_RECEIPT_IDS` entry to one path from the validated
opaque Profile/Account/Workspace layout. The plan has exactly the same IDs and each value is either a bounded
Buffer or explicit `null` absence.

Before the first write, the materializer inspects every target:

- absent target + present plan: eligible for atomic owner-only creation;
- present target + identical length/SHA-256: idempotent recovery;
- explicit absent plan + absent target: valid;
- every other state: conflict, zero writes.

Writes use same-directory owner-only temporary files, file fsync, atomic rename, directory fsync and Windows
current-user-only DACL protection/verification. Every directory is fsynced and every final file is re-read through
the no-follow receipt boundary before receipts are returned. A pre-rename failure leaves no target; a visible
post-rename failure is reported with `commitApplied` and remains safe for idempotent retry.

### Legacy retirement

`legacy-flat-source-retirement.js` accepts only the exact journal-bound legacy receipt set and derives every path
from `userData`. It first inspects all sources, so one mismatch or unexpected new source blocks before deletion.
Each present file is re-opened and rehashed immediately before its non-recursive unlink, followed by directory
fsync. Missing receipt-matched files are accepted as already retired after a prior committed-journal crash.

The fixed retirement order removes the old `settings.json` authority last. Partial unlink or fsync failure leaves
the committed journal in place; retry repeats receipt checks and completes without recursive deletion. The final
proof requires every legacy source path to be absent.

### Migration preconditions

The journal schema requires these legacy receipts to be absent before prepare:

- `credential-settings-transaction.json` — existing username/password recovery must finish first;
- `engine-owner.json` — stale/current Engine cleanup must finish first;
- `proxy-helper-credential.txt` — short-lived plaintext projection must be removed first.

This prevents migration from carrying an unresolved credential pair, a live Engine owner or plaintext helper.

## Verification

Fault tests cover target conflicts, links, rename failure, Windows ACL, source drift, unexpected sources, partial
unlink, directory-fsync failure, settings-last order and retry. A full temporary-directory integration uses the
real journal, source collector, destination materializer, bound encrypted VPN envelope, destination verifier,
coordinator and retirement adapter to complete one all-old to all-new migration.

## Non-activation boundary

Production `desktop/main.js` imports none of the P3d modules. The integration uses synthetic temporary files and
credentials only. Actual destination document planning, current credential decryption and application startup
wiring remain disabled.

## Next gate

P3e must build exact HKUST destination documents from validated legacy settings and a decrypted legacy credential,
preserve/copy each account-owned store without weakening its own schema, and model active/retired legacy rollback
state. Only then can a separate activation PR execute migration before any ordinary settings/credential read.
