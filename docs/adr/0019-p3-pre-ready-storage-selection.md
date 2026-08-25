# ADR-0019: P3 pre-ready storage selection

- Status: Accepted as a non-activating P3m seam
- Production Main activation: next patch
- Parent contracts: [`ADR-0016`](0016-p3-runtime-storage-path-seam.md),
  [`ADR-0018`](0018-p3-startup-recovery-runtime.md)

## Context

Electron safeStorage migration must wait for `app.whenReady()`, but several existing services are constructed while
Main is evaluated. On restart after migration, those services need scoped paths before safeStorage is touched. A
credential transaction can leave envelope presence inconsistent with Account metadata, so pre-ready selection
must not require complete credential authority or decrypt the envelope.

## Decision

The package-bound raw SchoolProfile is retained by `SchoolProfileRegistry` and exposed to Main only through
`withDefaultProfileDocument(callback)`. The callback is synchronous and receives the already frozen, hash-verified
source document; it cannot become an IPC or Renderer data path.

`selectProfileWorkspacePreReadyStorage()` performs no writes and no safeStorage call:

- active migration journal -> legacy path set, with migration recovery retaining ownership;
- no global destination settings -> legacy path set;
- destination global settings -> load recoverable Profile/Account/Workspace identity and select scoped paths.

The recoverable authority verifies reviewed Profile/Gateway/protocol and opaque identity but deliberately does not
require credential-file presence to match Account metadata. Startup recovery owns that intermediate state before
any connection. Corrupt or mismatched destination identity throws; it never silently falls back to legacy.

## Verification

Tests prove empty startup selects exact existing flat paths, a verified destination selects global/Account/Workspace
owners, selection remains possible during credential presence mismatch, an active migration journal retains legacy
selection, and the controller exposes only the frozen raw Profile through a synchronous callback.

## Next gate

P3n must consume this selector in Main, defer or neutralize all path-bound side effects until startup recovery,
branch settings/credential adapters by immutable runtime mode, and relaunch exactly once after a successful first
migration so the next process constructs services on scoped paths. It must never show UI or start Engine in a
partial/blocked state.
