# ADR-0018: P3 startup recovery runtime

- Status: Accepted as a non-activating P3l composition
- Production Main activation: next gate
- Parent contracts: [`ADR-0014`](0014-p3-runtime-settings-transaction.md),
  [`ADR-0015`](0015-p3-runtime-credential-transaction.md),
  [`ADR-0017`](0017-p3-production-migration-runtime.md)

## Context

After migration, a process can crash during legacy rollback retirement, Account/VPN credential redo or split
settings redo. Migration authority detection alone cannot safely repair those states. In particular, clearing a
credential removes ciphertext before Account metadata changes, so the complete runtime authority correctly fails
until the credential transaction owner repairs it.

The recovery order matters. A settings intent binds the Account credential revision; recovering settings before a
pending credential commit may bind it to stale identity. Conversely, credential recovery only needs Profile,
Account and Workspace identity documents and can tolerate its own credential intermediate state.

## Decision

`ProfileWorkspaceStartupRuntime.initialize()` is the only composition allowed to hand a Profile Workspace runtime
to production service construction. For an existing destination without an active migration journal it runs:

```text
load recoverable Profile/Account/Workspace identity
  -> reconcile legacy rollback retirement intent
  -> reconcile Account/VPN credential redo
  -> load complete runtime authority
  -> reconcile split settings redo
  -> reload complete authority
  -> run migration authority verification
  -> return immutable paths + settings store + credential store
```

When a migration journal exists, migration recovery retains ownership of partial destination files first. A new
migration completes and then the same runtime transaction recovery runs. Empty first launch remains legacy mode at
this gate.

The rollback store factory reads and validates its own original migration/account credential revision. It requires
that revision to be no newer than the active Account and still binds exact migration, Profile, Account, Gateway
and protocol identity. This permits a retired revision-1 rollback record to remain verifiable after later Account
credential rotations without treating the current revision as the original rollback authority.

No Engine, Browser, IPC, tray, log writer or path-bound store is created by this module. It returns owners only
after all recovery and authority checks succeed.

## Verification

Tests cover migration plus usable settings/credential adapters, credential replacement and clear, retired rollback
verification across Account revision changes, restart with a credential redo stopped after envelope write, and
restart with a split settings redo stopped between global and Workspace writes. Every recovery ends with no intent
file and one complete authority.

## Next gate

P3m must expose the reviewed raw SchoolProfile to Main through a callback-only controller boundary, invoke startup
runtime after Electron `ready`/safeStorage availability, defer all path-bound service construction until it returns,
and route settings/credential calls through mode-specific adapters. Engine/Browser/UI startup remains prohibited on
any bootstrap error. Packaged restart tests must run before replacing the installed App.
