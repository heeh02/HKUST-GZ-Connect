# ADR-0017: P3 production migration runtime composition

- Status: Accepted
- Owner: Desktop maintainers
- Last verified: 2026-09-04
- Applies to: `desktop/lib/persistence/migration/legacy-hkust/` and the 2.0 upgrade path
- Production Main activation: released in 2.0.0
- Parent contracts: [`ADR-0010`](0010-p3-destination-and-retirement.md),
  [`ADR-0030`](0030-p3-runtime-storage-path-seam.md)

## Context

The coordinator and destination planner previously had one synthetic filesystem composition in tests, but
production still lacked an owner for reading real flat payloads, decrypting the legacy safeStorage password,
sequencing migration and returning one verified runtime authority/path set. Reimplementing that sequence in Main
would mix credentials, filesystem recovery and UI lifecycle.

## Decision

`legacy-migration-inputs.js` reads every source through a bounded no-follow private-file descriptor and requires
its bytes to match the prepared journal receipt. Expected absence is also authoritative: a newly appeared file
blocks. `LegacyMigrationPayloadOwner` zeroizes all buffers after the synchronous planner callback.

The old safeStorage password is decrypted only into `LegacyMigrationCredentialOwner`, which stores username and
password in zeroizing buffers and exposes them only through a synchronous callback. Both owners are redacted for
JSON, string and diagnostic inspection.

`ProfileWorkspaceMigrationRuntime` composes:

```text
inspect exact legacy and destination authority
  -> prepare owner-only journal and opaque keys
  -> re-read every journal-bound legacy payload
  -> decrypt the paired legacy credential in Main memory
  -> build and materialize exact destination documents
  -> commit destination receipts
  -> verify destination authority
  -> retire receipt-matched flat files with settings last
  -> clear committed journal
  -> load complete Profile Workspace runtime authority
  -> return one immutable Profile Workspace runtime path set
```

A committed journal makes partial source retirement restart-safe. A second run recognizes the destination as
already migrated. Orphaned legacy files without `settings.json`, dual authority, changed receipts, invalid
credentials or incomplete destination state block rather than choosing an authority.

Windows uses two deliberately different ACL operations. Newly created private files may assign ownership to the
current SID before applying one protected FullControl rule. A legacy migration source may only be tightened when
the current SID already owns the exact regular single-link file; migration never takes ownership of a foreign
source. After tightening, the runtime re-identifies the file and only then hashes it into the migration receipt.
This admits 1.x files that merely inherited broader Windows rules without weakening the link, size, identity or
receipt checks.

An empty first launch remains in legacy-compatible mode for this gate because direct initialization of a new P3
Account has not yet been connected to the login flow. The next activation gate must either initialize an empty P3
Account or migrate immediately after first credential commit; it may not leave two writable authorities.

The runtime clones and freezes the original SchoolProfile document for repeated independent validation and keeps a
separate normalized Profile for internal fields. This prevents caller mutation and avoids passing a normalized
Gateway object back into a raw-document validator.

## Verification

Tests cover real flat-file migration with and without credentials, envelope decrypt round-trip, payload and
credential zeroization/redaction, changed/unexpected/symlink source rejection, empty first launch, orphaned legacy
authority, interrupted source retirement recovery, simulated Windows source/destination ACL enforcement, and a
real Windows current-owner file whose deliberately broadened DACL is tightened before use.

## Release maintenance

Main runs this composition only after Electron safeStorage is ready and before constructing any path-bound
service. It reconciles settings and credential redo intents, chooses one immutable runtime mode, creates every
service from that mode and prevents Engine/Browser/UI startup on ambiguous recovery. Packaged migration/restart
tests remain required before replacing an installed App.
