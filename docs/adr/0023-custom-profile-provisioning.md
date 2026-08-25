# ADR-0023: Crash-recoverable custom Profile provisioning

- Status: Accepted for 2.0 P6c/P6d
- Scope: inactive credential-free custom Profile/Account/Workspace creation
- Active Profile switch and credential entry: deferred

## Decision

Consuming a Main-owned Gateway confirmation produces one deterministic plan
with fresh opaque `profileKey`, `accountKey`, `workspaceKey` and provisioning
identity. The plan contains exactly eleven owner-only JSON targets:

- the raw `custom-local` SchoolProfile source document;
- a compiled-family Engine config bound to the confirmed origin;
- Profile settings and immutable Profile state;
- one credential-free primary CampusAccount;
- Workspace settings and Workspace scope;
- empty local resources, favorites, recents and external-integration state.

No VPN credential, Cookie, certificate pin, routing rule, Browser password,
proxy credential or log is copied. `autoConnect` is false and `routeDomains` is
an explicit empty set. The Browser partition is derived from the new Workspace
key and never reuses the HKUST legacy partition.

## Transaction

One owner-only global journal advances:

```text
prepared → materialized → indexed → clear
```

`prepared` binds the raw Profile document, opaque identities, creation time,
the SHA-256 receipt of every target file and the before/after CustomProfileIndex
receipts. The materializer preflights every target before its first write.
Absent targets are written by same-directory atomic replacement; already exact
targets are accepted during recovery; any other file, link, hard link, broad
permission, path escape or digest conflict blocks the transaction.

After every file is exact, `materialized` permits one additive index commit.
The index contains only custom `profileId`, opaque `profileKey` and creation
time. If a crash occurs after the index rename but before the journal advances,
the exact after receipt makes replay idempotent. `indexed` is cleared only after
both file receipts and index authority are reverified.

## Activation boundary

Provisioning never writes GlobalSettings and never activates an
`ActiveContextLease`. A completed custom Profile is inactive and has no
credential. A later P6 slice must load the persisted Profile from its exact
opaque root, create a Profile-aware Engine config, and run the existing P4
cleanup/activation journal before it becomes current. Renderer IPC must never
receive the provisioning context keys returned to Main.

Deletion remains deferred. Partial or conflicting destinations stay journaled
and fail closed; they are not recursively removed by startup guesses.
