# ADR-0016: P3 runtime storage path seam

- Status: Accepted as a behavior-preserving P3j seam
- Production migration: not enabled by this ADR
- Parent contracts: [`ADR-0013`](0013-p3-runtime-authority.md),
  [`ADR-0015`](0015-p3-runtime-credential-transaction.md)

## Context

Production Main previously constructed eleven flat user-data paths directly at module load and immediately handed
them to log, routing, certificate, Browser credential, Engine-owner and proxy-credential services. Running the P3
migration while those services still point at retired flat files would create a split authority and break the
application even if migration itself succeeded.

Moving all service initialization and migration in one patch would combine path ownership, lifecycle ordering,
credential recovery and user-visible behavior. The first safe step is a path seam whose legacy projection is byte
for byte identical to 1.2.3.

## Decision

`runtime-storage-paths.js` defines one exact set of runtime targets:

```text
settings + transaction/backup authority
VPN credential + credential transaction
Engine log/rotation/retention
external and Browser PAC
routing rules
website credential vault
certificate trust
Engine owner record
stable proxy credential and helper sidecar
```

`createLegacyRuntimeStoragePaths()` maps these names to the existing flat paths. Production Main now obtains every
path from this projection through its existing `app-data-dir` dependency, so Main dependency count and external
behavior remain unchanged.

`createProfileWorkspaceRuntimeStoragePaths()` maps the same service owners to global, Account or Workspace paths
from a validated runtime authority. Its settings field names only the global bootstrap document; split settings
must still be accessed through `ProfileWorkspaceSettingsStore`, never by the old flat settings parser.

Both projections require an absolute normalized userData root, exact complete unique targets and containment below
that root. No username, Gateway hostname or other user-derived value participates in a filesystem path.

## Verification

Tests prove every legacy path is unchanged, every Profile Workspace service maps to its documented owner, malformed
or duplicate targets fail, opaque paths contain no identity/Gateway material and Main no longer constructs
`settings.json` or `cred.bin` directly. Existing full Desktop tests cover the behavior-preserving production seam.

## Next gate

P3k must defer construction of path-bound services until `app.whenReady()`, run legacy/P3 transaction recovery and
migration before choosing one immutable runtime path set, and prevent any service or connection from starting when
authority is ambiguous. Only then can a packaged test App replace the installed version.
