# ADR-0012: P3 legacy credential rollback retirement

- Status: Accepted as a non-activating P3f contract
- Production migration: not enabled by this ADR
- Parent contract: [`ADR-0011`](0011-p3-hkust-destination-plan.md)

## Context

P3e retains one independently bound copy of the old encrypted VPN credential for a one-release rollback path.
Deleting that file with a single unlink is not enough: a crash may leave active metadata without ciphertext,
retired metadata with resurrected ciphertext, or a credential mutation that reports success while reusable old
ciphertext remains.

## Decision

`LegacyCredentialRollbackStore` is the only persistent owner of the account-scoped rollback blob, state and
retirement intent. It validates the exact migration/Profile/account credential revisions, Gateway origin and
ProtocolFamily before reading or changing any of them. The rollback blob is exposed only by the explicit
`readActiveRollbackBlob()` adapter; ordinary connection and auto-connect code do not import the store.

Retirement is one monotonic transaction:

```text
persist owner-only retirement intent
  -> verify and unlink receipt-bound rollback ciphertext
  -> fsync account directory
  -> atomically commit retired metadata
  -> verify the committed state
  -> unlink retirement intent
  -> fsync account directory
```

Password replacement, credential clear/logout, account removal and Profile reset must call
`retireBeforeMutation()` before their own mutation can run. A later mutation failure does not reactivate the old
credential.

## Recovery and failure policy

- intent + active state + present or missing matching blob resumes retirement;
- intent + matching retired state clears the completed intent;
- retired state + a matching resurrected dedicated blob creates an intent and removes it;
- active state + missing blob without an intent is ambiguous and blocks;
- missing state + present blob, binding mismatch, altered receipt, malformed intent, symlink, shared POSIX inode
  or non-owner-only Windows ACL blocks;
- no recovery path invents a successful retirement or copies ciphertext back into place.

All JSON documents use bounded private-file reads and atomic owner-only writes. POSIX paths require a link-free,
owner-only directory chain and single-link files. Windows temporary and committed files require current-user-only
DACL protection and verification.

## Verification

Tests cover normal and repeated retirement, explicit rollback reads, blob unlink failure, crash after blob
deletion, state commit failure, intent-clear failure, active/missing ambiguity, retired/blob resurrection,
binding mismatch, symlink substitution, malformed intent, mutation failure after retirement and simulated Windows
ACL protection.

## Non-activation boundary

Production `desktop/main.js` does not import this store or any other P3 migration module. P3f changes no installed
credential, settings, Browser partition, connection behavior or release package. Production activation remains a
separate gate that must wire all credential-mutating operations through this retirement contract and run packaged
migration/recovery tests before a test App replaces the installed version.
