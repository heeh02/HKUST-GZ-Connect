# ADR-0007: P3 profile/account/workspace storage foundation

- Status: Accepted as a non-activating P3 foundation
- Production migration: not enabled by this ADR
- Parent contracts: [`ADR-0004`](0004-profile-account-workspace-scope.md),
  [`ADR-0006`](0006-production-provider-composition.md)

## Context

The 1.x application still owns one flat `userData` namespace. P1 defined persistent Account/Workspace schemas and
P2 added a process-lifetime account handle, but no code safely derives the future on-disk hierarchy or records an
all-old/all-new migration boundary.

P3 eventually migrates credentials, Browser state, certificate grants, routing and local resources. Activating
that migration before its key, path and journal contracts are independently testable would put existing user
state at risk.

## Decision

This batch adds three inert building blocks:

1. `profile-workspace-layout.js` derives every future path from installation-local opaque profile/account keys.
   Profile IDs, Gateway hosts, usernames and labels are never path components. A non-migrated workspace receives
   a deterministic partition digest; only the explicit migrated HKUST primary path may adopt
   `persist:hkustgz-campus-browser`.
2. `profile-workspace-migration-journal.js` owns generation of `profileKey`, `accountKey`, `workspaceKey` and the
   migration ID. Entropy buffers are exact-length and erased immediately. The exact schema stores only bounded
   SHA-256 receipts and identity/revision bindings—never file contents, username, password, Cookie or token.
3. `profile-workspace-migration-store.js` persists one owner-only journal with a monotonic
   `prepared -> committed -> cleared` lifecycle. It rejects symlinks, hard links, broad POSIX permissions,
   replacement identities and non-atomic commit failures.

The existing production `main.js` does not import these modules. No directory is created and no existing user
file, Browser partition or credential is read, copied, moved or deleted in this batch.

## Security and recovery properties

- All persistent keys are opaque and distinct; raw user or deployment values cannot select a path.
- Source/destination receipt sets have exact logical IDs and a canonical aggregate digest.
- Prepared journals cannot be overwritten or cleared.
- A commit must retain the same migration/Profile/origin/family/key/source binding.
- Commit writes use an owner-only same-directory temporary file, file fsync, atomic rename and directory fsync.
- If directory fsync fails after rename, a matching readable committed document is reported as
  `durabilityUnconfirmed`; later activation must treat this as a recovery state, not silent success.
- Journal reads use the existing bounded no-follow single-link private-file boundary.

## Deferred activation work

The next P3 batches must still implement and test:

- legacy source/destination receipt collection through opened descriptors;
- journaled directory creation and bound VPN credential-envelope re-encryption;
- all-old/all-new recovery and exact retirement of flat authorization stores;
- settings split, workspace store adapters and legacy rollback-blob state;
- Browser partition adoption and production Main wiring;
- fault injection at every write/fsync/rename/unlink boundary.

Until those gates pass, the flat 1.x storage path remains the only production authority.
