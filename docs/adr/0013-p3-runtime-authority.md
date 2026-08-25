# ADR-0013: P3 active Profile/Account/Workspace runtime authority

- Status: Accepted as a non-activating P3g contract
- Production storage switch: not enabled by this ADR
- Parent contracts: [`ADR-0011`](0011-p3-hkust-destination-plan.md),
  [`ADR-0012`](0012-p3-rollback-retirement.md)

## Context

The migration planner can write split global, Profile, Account and Workspace documents, but production cannot
switch from the legacy flat paths until it can prove that one exact destination tree belongs to the packaged
reviewed Profile. Reading files merely because they appear below an opaque directory would permit stale or
cross-account state to become active.

The account document contains the Workspace key, so runtime discovery also needs a bounded bootstrap layout that
can reach only global, Profile and Account authority before the final Workspace layout and Browser partition are
derived.

## Decision

`profile-workspace-documents.js` is the single strict schema for:

- global active keys and application settings;
- global update state;
- Profile settings and immutable migration/Profile/Gateway state;
- Workspace connection and routing settings.

The HKUST destination planner validates every emitted document through these same functions. Runtime never
normalizes malformed destination documents to defaults; unknown fields, noncanonical route domains and invalid
security combinations fail closed.

`loadActiveProfileWorkspaceAuthority()` follows one ordered chain:

```text
validated reviewed SchoolProfile
  -> owner-only global settings and active opaque keys
  -> bootstrap Profile and Account paths
  -> exact Profile settings/state
  -> exact enabled primary CampusAccount
  -> final Workspace layout from the bound workspaceKey
  -> exact Workspace settings/state
  -> owner-only VPN ciphertext presence receipt
```

Every layer must match the reviewed Profile ID/revision, credential-binding revision, Gateway origin,
ProtocolFamily, Account key/revision and Workspace key/revision. Credential presence must agree with
`activeCredentialVersion`. The loader hashes the bounded ciphertext only to prove private-file presence and never
decrypts it, asks secure storage for access or returns a username/password.

All parent directories are required to be owner-only and link-free on POSIX. Every document and credential must
have a current-user-only DACL on Windows. The returned authority is Main-internal and contains persistent opaque
keys; it is not a Renderer projection.

## Verification

Tests cover exact immutable schemas, canonical routing values, bootstrap/full-layout agreement, successful
credential and credential-free Accounts, cross-account lookup, reviewed Profile/Gateway drift, credential
presence drift, symlink substitution, unsafe private files and simulated Windows ACL verification. The planner's
existing migration tests prove that writer and reader share the schema.

## Non-activation boundary and next gate

Production `desktop/main.js` does not import the runtime authority. P3h must add transactionally writable split
settings and VPN credential adapters while keeping the legacy UI/connection behavior as a projection. Only P3i
may activate startup migration and replace the installed test App after packaged restart/recovery tests pass.
