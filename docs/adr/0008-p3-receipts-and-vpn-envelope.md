# ADR-0008: P3 legacy receipts and bound VPN credential envelope

- Status: Accepted as a non-activating P3b contract
- Production migration: not enabled by this ADR
- Parent contracts: [`ADR-0004`](0004-profile-account-workspace-scope.md),
  [`ADR-0007`](0007-p3-storage-foundation.md)

## Context

ADR-0007 can derive the future storage layout and persist a receipt-bound migration journal, but P3 still needs
two security-critical inputs before an orchestrator may touch existing state:

1. a stable snapshot receipt for every flat 1.x authority; and
2. one encrypted object that keeps the legacy username and password paired with their destination account.

Reading by path and hashing later would leave a replacement window. Migrating the current plaintext username
and encrypted password independently could commit a credential for the wrong account.

## Decision

### Legacy receipt collection

`legacy-flat-source-receipts.js` derives the exact existing paths from the normalized `userData` root. Callers
cannot supply arbitrary source files. The set includes settings/backup, VPN credential, routing/PAC, website
vault, certificate trust, Engine owner, the existing credential transaction, proxy credential/helper projection,
and current/rotated/retention log files. Each present source is processed through one no-follow descriptor:

```text
lstat and policy check
  -> Windows DACL verification when applicable
  -> O_NOFOLLOW open
  -> fstat identity/version comparison
  -> bounded chunked SHA-256 with immediate buffer clearing
  -> final fstat identity/version comparison
```

The comparison covers device/inode, size, mtime and ctime. POSIX sources must be regular, single-link and
owner-only. Missing files produce an explicit absent receipt; a file that disappears after observed presence is
an error. Receipt output contains only `present`, `bytes` and `sha256`, never file contents.

### VPN credential envelope

`vpn-credential-envelope.js` encrypts username and password together with:

```text
profileId / profileCredentialBindingRevision
accountKey / accountCredentialRevision
GatewayOrigin / ProtocolFamily
credentialVersion / updatedAt
```

Unknown fields, control characters, empty values, oversized values, an unavailable protected store and Linux
`basic_text` all fail closed. Decryption requires the exact expected binding before it returns a credential
owner. The owner keeps username/password in Buffers, redacts JSON/string/inspect output and supports explicit
zeroizing destruction.

Electron `safeStorage` accepts/returns JavaScript strings, so immutable temporary strings cannot be overwritten.
The implementation removes references immediately and clears parsed string fields; the persistent and
longer-lived owner remains Buffer-backed and zeroized.

### Encrypted envelope store

`vpn-credential-envelope-store.js` stores only ciphertext below the account path. It uses an owner-only
same-directory temporary file, file fsync, atomic rename and directory fsync. Windows protects the temporary
file and verifies the committed DACL. Reads are bounded/no-follow/single-link; observed disappearance fails
closed. Replacement failure preserves the prior ciphertext. If rename applied but directory fsync failed, the
store compares the visible ciphertext in constant time and raises an error with `commitApplied = true` so the
future migration coordinator can recover rather than repeat blindly.

## Non-activation boundary

Production `desktop/main.js` imports none of these P3b modules. This batch does not decrypt the installed legacy
credential, write a destination envelope, collect receipts from the actual user profile or move/delete any flat
file. It introduces no Renderer or IPC surface.

## Deferred work

P3c must gate all flat writers, complete the existing credential/settings recovery first, collect receipts,
write the full destination tree, re-encrypt the legacy credential in memory, verify destination receipts and
drive the ADR-0007 journal through all-old/all-new recovery. Legacy authorization-store retirement and rollback
blob state remain separate required gates.
