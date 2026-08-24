# ADR-0009: P3 all-old/all-new migration coordinator

- Status: Accepted as a non-activating P3c contract
- Production migration: not enabled by this ADR
- Parent contracts: [`ADR-0007`](0007-p3-storage-foundation.md),
  [`ADR-0008`](0008-p3-receipts-and-vpn-envelope.md)

## Context

P3a supplies a durable journal and P3b supplies stable legacy/destination receipts plus a bound VPN credential
envelope. A migration still needs one authority that decides which state may be used after a crash. Performing
independent “file exists” checks in `main.js` would reintroduce mixed old/new state and stale credential risks.

## Decision

`ProfileWorkspaceMigrationCoordinator` is a synchronous, single-flight Main-domain service. It receives narrow
storage adapters; it does not parse credentials, Browser data or routing policy itself.

### No journal

```text
legacy only       -> prepare migration
destination only  -> already migrated
neither           -> not applicable/new installation
both              -> AMBIGUOUS_AUTHORITY, fail closed
```

### Prepared journal

The coordinator re-collects every legacy receipt and compares the canonical aggregate digest. Any difference,
missing legacy authority or invalid binding blocks migration. With an exact match it invokes an idempotent
destination builder using the journal's original opaque keys and legacy Browser partition adoption. It then
commits exact destination receipts to the journal.

A crash before/during destination construction retains `prepared`; the next run resumes with the same identity.
Prepared state is never silently cleared or regenerated.

### Committed journal

Committed state makes destination the only candidate authority, but it is not finalized blindly. The
coordinator verifies all destination receipts, then invokes idempotent legacy retirement. It confirms that old
authority is absent and destination authority remains present before clearing the committed journal.

A crash during retirement retains `committed`; the next run repeats verification and retirement. Receipt drift,
missing destination or unconfirmed retirement blocks rather than falling back.

### Other invariants

- every callback is synchronous so startup cannot interleave another connection/storage continuation;
- reentrant calls return `MIGRATION_ALREADY_RUNNING` without side effects;
- results expose only bounded status/authority/error code, never paths, identities or secrets;
- durability-unconfirmed prepare/commit results require a matching journal reread;
- journal confirmation compares Profile/origin/family/revisions, legacy partition, timestamps, opaque identity
  and source/destination digests;
- 100 post-migration checks remain idempotent and perform no additional build/retirement work.

## Verification

Synthetic fault tests cover crash after prepare, changed legacy sources, crash after commit, changed destination,
ambiguous dual authority, reentrancy and repeated recovery. A real owner-only filesystem journal store completes
one full coordinator contract round to prevent fake/store interface drift.

## Non-activation boundary

Production `desktop/main.js` does not import the coordinator. Destination building, actual legacy credential
decryption, Browser partition adoption and old-file retirement are not implemented in this batch. No installed
user data is read or mutated.

## Next gate

P3d must implement concrete destination writers and legacy retirement as separately fault-injected adapters.
Only after those adapters prove exact all-old/all-new recovery may a later PR place the coordinator before any
settings read, credential decrypt, Engine start or Campus Browser session creation.
