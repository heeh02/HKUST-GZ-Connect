# ADR-0014: P3 split runtime settings transaction

- Status: Accepted as a non-activating P3h contract
- Production storage switch: not enabled by this ADR
- Parent contract: [`ADR-0013`](0013-p3-runtime-authority.md)

## Context

The 1.x settings API presents one normalized object, while the P3 destination correctly separates application
settings, Workspace connection/routing settings, update state and local Web resources. A direct series of four
atomic file writes would still permit a crash to expose a mixed old/new settings view. It would also tempt the
compatibility layer to persist the account label that P3 intentionally keeps inside the encrypted VPN envelope.

## Decision

`profile-workspace-settings-bundle.js` is the compatibility projection boundary. It:

- projects exact global/Workspace/update/resource documents into the current normalized settings shape;
- accepts an optional in-memory account label for current UI compatibility;
- splits a canonical settings object back into the four owner documents;
- rejects password/unknown fields and never writes the account label;
- stores Web resources without the runtime-only `builtin` origin marker.

`ProfileWorkspaceSettingsStore` commits the four documents through one owner-only redo intent. The transaction is
bound to Profile ID/key, Profile credential revision, Account key/credential revision, Workspace key/context
epoch, Gateway origin and ProtocolFamily. It contains exact before/after receipts and bounded base64 after-bytes
for these non-credential documents only.

```text
verify active authority and every before receipt
  -> atomically persist redo intent
  -> replace each before target with its exact after document
  -> verify every after receipt
  -> clear intent and fsync its directory
```

Before the intent commit, no target changes. Once the intent is committed, restart recovery deterministically
finishes all-new. A target that matches neither receipt, a context/revision switch, malformed intent, private-file
failure or untrusted ACL blocks; recovery never guesses or overwrites out-of-band state.

The redo document may contain local URLs and settings, so it is private, bounded, never logged and cleared after
commit. It contains no VPN password, website password, Cookie/token, account label or decrypted credential.

## Verification

Tests cover projection/split round trips, account-label non-persistence, unknown/password rejection, resource
writer/reader idempotence, normal and no-op commits, crash during target writes, failure before intent commit,
intent-clear crash, out-of-band mutation, Account credential-revision drift and simulated Windows ACLs. P3
migration destination tests include the initially absent transaction path.

## Non-activation boundary and next gate

Production `desktop/main.js` imports neither settings projection nor transaction store. P3i must first add an
equivalent Account/VPN credential transaction that composes rollback retirement, credential envelope and Account
metadata. Only after settings and credential mutations share the new authority can startup migration switch Main
and produce a test App.
