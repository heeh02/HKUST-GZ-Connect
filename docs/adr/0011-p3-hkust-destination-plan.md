# ADR-0011: P3 HKUST destination plan and legacy credential rollback state

- Status: Accepted as a non-activating P3e contract
- Production migration: not enabled by this ADR
- Parent contracts: [`ADR-0008`](0008-p3-receipts-and-vpn-envelope.md),
  [`ADR-0010`](0010-p3-destination-and-retirement.md)

## Context

P3d can materialize an exact file map, but a production migration cannot feed it arbitrary Buffers. The HKUST
adapter must split flat settings by owner, pair the legacy username/password, construct validated Account and
Workspace documents, and preserve a one-release rollback path without making old credentials available to
ordinary auto-connect.

## Decision

`hkust-migration-destination-plan.js` accepts only:

- one validated prepared HKUST migration journal;
- the receipt-matched raw legacy `settings.json` bytes;
- exact receipt-matched payloads for proxy credential, routing/PAC, website vault, certificate trust and logs;
- the receipt-matched legacy VPN ciphertext;
- one Main-only credential owner that synchronously exposes the matching username/password;
- protected `safeStorage`, platform and a bounded timestamp.

### Settings ownership split

The plan writes:

- global settings: active opaque keys, port, strict proxy policy, close/language/start-at-login;
- global update state: update-check timestamp;
- profile settings/state: reviewed Profile revision, credential binding, origin/family and primary account key;
- workspace settings: auto-connect/reconnect, retry count and route domains;
- local resources: normalized custom Web resources;
- empty versioned favorites, recent-resource and external-integration documents.

The plaintext legacy username is removed from every settings/document output.

### Account and VPN credential

The planner requires these three facts to agree:

```text
settings.username is present
legacy vpn credential receipt/ciphertext is present
credential owner returns the same username plus password
```

They must also all be absent together. A mismatch fails before destination materialization. The matching pair is
encrypted into the P3 profile/account/origin/family-bound VPN credential envelope. `account.json` and
`workspace-state.json` are validated through the existing P1 schemas before their canonical persistent documents
are emitted.

### Legacy rollback state

When a legacy ciphertext exists, the destination account receives:

- `legacy-vpn-credential-rollback.bin` — an independent copy of the original ciphertext;
- `legacy-vpn-credential-rollback.json` — exact `active` metadata binding migration ID, Profile credential
  revision, account credential revision, origin/family and source receipt.

With no legacy credential, the blob is absent and state starts `retired/no_legacy_credential`. Retirement is
monotonic and reason-bound (`credential_replaced`, `credential_cleared`, `account_removed`, `profile_reset`).
Metadata contains no username/password.

All copied payloads and rollback ciphertext are cloned so mutation of caller-owned Buffers after planning cannot
invalidate the completed source-receipt check.

## Verification

Tests cover exact destination IDs, settings ownership, P1 Account/Workspace round-trip, plaintext identity
absence, payload/ciphertext receipt mismatch, username mismatch, credential/no-credential paths, input immutability,
rollback state schema and monotonic retirement. The full temporary-directory migration now uses this planner
rather than a hand-built file map.

## Non-activation boundary

Production `desktop/main.js` imports neither planner nor rollback state. No installed settings or credential is
read, decrypted or written. The next P3f gate must implement rollback blob retirement/reconciliation and prove
credential replacement/logout/reset cannot report success while reusable legacy ciphertext remains.
