# ADR-0015: P3 Account and VPN credential transaction

- Status: Accepted as a non-activating P3i contract
- Production storage switch: not enabled by this ADR
- Parent contracts: [`ADR-0012`](0012-p3-rollback-retirement.md),
  [`ADR-0013`](0013-p3-runtime-authority.md)

## Context

Replacing or clearing a VPN credential changes both the encrypted envelope and `account.json`. These files cannot
be updated with the settings redo transaction because their intermediate states intentionally fail the complete
runtime authority check. A clear may remove ciphertext before Account metadata is committed; a replacement may
write a newly bound envelope while the Account still names the previous credential revision.

Recovery therefore needs a narrower Profile/Account bootstrap authority that validates the immutable reviewed
Profile, Gateway, protocol, Account and Workspace identity without requiring credential presence to match yet.
Ordinary runtime and connection paths continue to use the complete authority and fail closed in intermediate
states.

## Decision

`ProfileWorkspaceCredentialStore` owns replacement, clear, explicit decrypt and crash recovery for:

- `account.json`;
- `vpn-credential.bin`;
- `credential-transaction.json`.

Before either mutation it requires `LegacyCredentialRollbackStore` retirement to be proven. A failed rollback
retirement prevents the credential intent and both targets from changing. Once retired, failure later in the new
credential transaction never reactivates or restores legacy ciphertext.

The redo intent is bound to the invariant Profile ID/key, Profile credential revision, Account key, Workspace
key/context epoch, Gateway origin and ProtocolFamily. Exact Account and credential before/after receipts detect
all out-of-band changes. The after Account document and encrypted after envelope are stored as bounded base64;
username and password never appear in the intent, Account document, logs or Renderer state.

Replacement increments the dedicated Account credential revision and active credential version, encrypts the
username/password against the new binding, writes the envelope first, then commits Account metadata. Clear
increments the credential revision, durably removes the envelope first, then commits `activeCredentialVersion =
null`. A credential-free clear still proves rollback retirement but does not churn revisions.

Explicit `open()` first reconciles pending intent, validates the complete runtime authority, then decrypts the
envelope into a zeroizing Main-owned `DecryptedVpnCredential`. Status and settings reads never decrypt it.

## Recovery and failure policy

- no intent means neither target is repaired or guessed;
- with an intent, each target must match its exact before or after receipt;
- recovery writes/removes the after credential before committing after Account metadata;
- all after receipts are verified before the intent is cleared;
- malformed intent, binding drift, target drift, link/private-file failure or ACL failure blocks;
- recovery must run before complete runtime authority or any connection attempt at production startup.

## Verification

Tests cover replacement/decryption/zeroization, clear, credential-free clear, legacy retirement ordering, no
plaintext in persistent targets or redo intent, crash after credential write, crash after credential removal,
out-of-band Account mutation and simulated Windows ACL protection. Existing authority tests prove complete reads
reject credential-presence drift while the bootstrap reader remains available to the transaction owner.

## Non-activation boundary and next gate

Production `desktop/main.js` does not import this store. P3j must compose startup migration recovery, settings
redo recovery, credential redo recovery, rollback retirement and new-path runtime adapters before any legacy flat
authority is retired. Only after packaged restart/fault tests pass may P3j build a test version and directly replace
the installed macOS App.
