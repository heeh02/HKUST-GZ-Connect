# ADR-0020: P3 desktop persistence runtime adapter

- Status: Accepted as a non-activating P3n adapter
- Production Main consumption: next patch
- Parent contracts: [`ADR-0018`](0018-p3-startup-recovery-runtime.md),
  [`ADR-0019`](0019-p3-pre-ready-storage-selection.md)

## Context

Main and its IPC currently expect one settings object plus credential load/save/clear functions. Profile Workspace
storage has separate transactional settings and credential owners and deliberately does not persist the username
as a settings field. Direct branching at every call site would spread migration mode throughout UI, connection,
routing and external integration code.

## Decision

`DesktopPersistenceRuntime` binds one pre-ready mode for the lifetime of a process and exposes:

- normalized settings load/save;
- credential replace/clear;
- explicit zeroizing connection credential owner;
- non-decrypting credential presence;
- Account-identity presence independent of plaintext settings username;
- immutable selected runtime paths.

Legacy mode delegates to the existing flat stores. Profile Workspace mode delegates only to
`ProfileWorkspaceSettingsStore` and `ProfileWorkspaceCredentialStore`, reloads authority after mutations and keeps
the observed account label in process memory only. `ObservedCredentialOwner` learns that label when Main explicitly
opens credentials for a connection and remains redacted/zeroizing.

If after-ready startup migration returns a different mode from pre-ready selection, the adapter remains not ready
and returns `relaunchRequired`. It never enables the old and new stores together in one process.

`createControlStateSnapshot` now receives a separate `hasAccountIdentity` dependency. Legacy Main preserves the
old username check; Profile Workspace can report a logged-in Account from bound credential metadata without
persisting or decrypting a username for routine status reads.

## Verification

Tests prove first-migration mode change requests relaunch and blocks store access, legacy delegation remains
unchanged, Profile Workspace operations never touch legacy stores, account labels remain memory-only, connection
credential owners are redacted/destroyed, and an Account with empty projected username remains logged in through
the explicit identity signal.

## Next gate

P3o must instantiate this adapter in Main from pre-ready selection, run after-ready startup before UI/Engine, use
its paths for every service, route existing settings/credential IPC and `connectOnce` through it, and perform a
bounded one-time relaunch after first migration. Packaged two-process migration tests precede App replacement.
