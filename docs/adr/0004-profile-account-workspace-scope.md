# ADR-0004: School profile, campus account and workspace scope

- Status: Proposed for 2.0 preparation
- Decision owner: project maintainer
- Production activation: not authorized by this ADR alone
- Parent decision: [`ADR-0003`](0003-multi-school-profile-and-custom-gateway.md)

## Context

ADR-0003 establishes one active school profile at a time and requires profile-scoped credentials, Browser
state, certificate decisions and routing. That is sufficient to prevent one school's state from entering
another school, but it does not permanently separate deployment identity from user identity.

One school or Gateway may legitimately be used with more than one identity: student and staff accounts, a
maintainer test account, a replacement account, or different users of one computer. If mutable user state is
written directly under `profiles/<profileKey>/`, adding a second account later would require another high-risk
credential, Chromium partition, certificate and routing migration.

The current 1.x implementation is entirely flat:

| Current owner | Current path/module | Current content |
| --- | --- | --- |
| app | `desktop/main.js` userData constants | one settings, credential, PAC, log and owner set |
| settings | `desktop/lib/settings-store.js` | username, connection policy, route domains and custom resources |
| VPN credential | `desktop/lib/credential-store.js` | one encrypted password blob |
| Browser | `desktop/lib/browser-session-manager.js` | one fixed persistent Campus partition |
| site credentials | `desktop/lib/campus-credential-vault.js` | one encrypted exact-origin vault |
| certificate trust | `desktop/lib/campus-certificate-trust.js` | one exact-origin/fingerprint grant set |
| routing | `desktop/lib/routing-rule-store.js` | one user rule document |
| resources | `desktop/lib/campus-resources.js` | reviewed builtins plus one custom-resource list |

The initial 2.0 UI still needs only one primary account per profile. The on-disk and lifecycle boundary must,
however, be account-ready from the first P3 migration.

## Decision

Adopt three distinct domains:

```text
SchoolProfile
  └── CampusAccount
        └── WorkspaceScope
```

The first implementation permits exactly one enabled `primary` account for each profile. It nevertheless uses
opaque account and workspace keys and stores account-owned state below:

```text
profiles/<profileKey>/accounts/<accountKey>/
```

This ADR is a compatible refinement of ADR-0003. It does not weaken profile isolation, immutable
`GatewayOrigin`/`ProtocolFamily`, custom-Gateway confirmation, or the single-active-Engine decision. The
profile-level layout in ADR-0003 remains valid for deployment-owned data; this ADR is authoritative for every
account-owned leaf before P3 is implemented.

## Domain model

### SchoolProfile

`SchoolProfile` describes a reviewed or custom-local deployment. It owns no user identity or user grant.

```text
SchoolProfileInternal
  profileId / opaque profileKey / profileRevision
  profileCredentialBindingRevision
  evidenceClass
  immutable GatewayOrigin
  immutable ProtocolFamily
  provider/config references
  reviewed branding, DNS and Browser defaults
  builtin resource descriptors

SchoolProfileView
  profileId / profileRevision / evidenceClass
  bounded display name and asset key
  normalized Gateway origin for explicit display
  sanitized compatibility
```

Changing origin or protocol creates a new profile and copies no account or workspace. ADR-0003 remains the
authority for profile registry trust and safe custom-Gateway onboarding.

### CampusAccount

`CampusAccount` is a local identity slot bound to exactly one immutable profile deployment.

```text
CampusAccountInternal
  schemaVersion
  accountKey                 opaque random key; never username-derived
  accountRevision
  accountCredentialRevision
  role = primary             first release only
  state = enabled | disabled | deleting | tombstoned
  profileId / profileRevision
  GatewayOrigin binding
  ProtocolFamily binding
  workspaceKey               opaque random key
  activeCredentialVersion?
  createdAt / updatedAt

CampusAccountView
  accountHandle              short-lived Main-issued UI correlation
  role
  state
  bounded user-chosen label?
  hasCredential
  isActive
```

`accountKey` and `workspaceKey` remain persistent filesystem/store owners and never cross to Renderer.
`accountHandle` is non-persistent, sender + active-context-bound and invalidated whenever the Renderer, profile
or account context changes. Main resolves and revalidates it; it is never accepted as a path component.

The username is an authentication identifier and is stored inside the encrypted VPN credential envelope, not
in plaintext account metadata, logs or ordinary Renderer state. A user-chosen account label is optional,
bounded plain text and never used as a credential or filesystem key. Renderer views do not expose the raw
username by default; the login/edit flow may hold it only for the explicit credential operation.

The first release enforces:

- at most one enabled account per profile;
- that account has role `primary`;
- no add-account or account-switch UI;
- profile activation selects its primary account or remains disconnected when none is usable.

These constraints are product policy, not storage assumptions. Future multiple-account support can relax them
without moving state.

### VPN credential envelope

Username and password commit as one encrypted object:

```text
VpnCredentialEnvelope
  schemaVersion
  profileId / profileCredentialBindingRevision
  accountKey / accountCredentialRevision
  exact GatewayOrigin
  exact ProtocolFamily
  credentialVersion
  username
  password
  updatedAt
```

The envelope has no `Debug`/diagnostic representation containing username or password. Main validates active
profile, account, origin, family, config digest and epochs before secure-store decryption, following ADR-0003's
credential-bearing launch order. Username and password are never committed independently. A failure cannot
produce an account label/username paired with another credential.

The credential-binding revisions change only when a security identity boundary changes: Gateway origin,
ProtocolFamily, account credential identity or an explicit credential reset. Branding, builtin-resource,
favorite/recent and ordinary account-metadata revisions do not invalidate a valid credential.

ADR-0003's `LegacyCredentialRollbackState` remains profile- and account-binding authority for the one-release
HKUST rollback blob. The migrated blob binds to the newly created HKUST primary `accountKey`; password
replacement, logout/credential clear, account removal or profile reset retires it before success.

### WorkspaceScope

`WorkspaceScope` owns mutable user experience and authorization state for one `CampusAccount`.

```text
WorkspaceScope
  profileId / profileRevision
  accountKey / accountRevision
  workspaceKey
  activeContextEpoch

  Browser partition
  website credential vault
  certificate trust grants
  favorites
  recent resources
  local resource descriptors
  user routing rules and PACs
  authenticated/server resource projection
  active Gateway session and notices
  account-scoped diagnostics
```

Reviewed builtin resources and deployment DNS/default policy remain profile-owned. The account workspace owns
favorites, recent entries, locally added resources, user route overrides and authenticated server resources,
because their visibility or authorization may differ by account.

Favorites and recent history store opaque resource handles plus bounded display timestamps, not full Browser
navigation history. An arbitrary recent URL is reduced to a reviewed/local resource handle or a sanitized HTTPS
origin with no query, fragment, SAML assertion, OAuth code or other one-time material.

## Persistent layout

```text
userData/
  global/
    settings.json
    proxy-credential.bin
    proxy-helper-credential.txt
    engine-owner.json
    update-state.json
    active-context-switch.json?

  profiles/<profileKey>/
    profile-settings.json
    profile-state.json
    accounts/
      <accountKey>/
        account.json
        vpn-credential.bin
        credential-transaction.json
        deletion-tombstone.json?
        workspace/
          workspace-state.json
          campus-credentials.json
          campus-certificate-trust.json
          routing-rules.json
          routing.pac
          browser-routing.pac
          local-resources.json
          favorites.json
          recent-resources.json
          engine.log
```

`profileKey`, `accountKey` and `workspaceKey` are registry/generated bounded opaque values. Raw profile IDs,
Gateway hosts, usernames and labels are never path components. All directories/files retain current no-follow,
single-link, owner-only or Windows current-user ACL requirements.

App-global local proxy credentials remain global because they authorize the one active loopback listener, not a
school identity. Their plaintext sidecar remains short-lived and is destroyed on any profile/account/context
transition. The sidecar and Engine owner record bind the current active-context epoch and Engine generation.

## Browser partition and local website state

Each account owns one persistent Browser partition derived from its opaque `workspaceKey`, for example:

```text
persist:campus-workspace-<bounded opaque digest>
```

The partition name is deterministic for that workspace but cannot disclose a username or accept raw path data.
Campus and Direct continue to share the account's one partition, preserving same-account Cookie, POST and SAML
continuity. Different accounts under the same school do not share Cookies, localStorage, IndexedDB, cache,
downloads state, service workers or permission state.

The existing `persist:hkustgz-campus-browser` partition is adopted only by the migrated HKUST primary account.
It is never opened by another profile/account and is not copied.

Website credentials and certificate grants are additionally account-scoped even though each entry remains
exact-origin bounded. A pin or saved website password confirmed by account A cannot authorize or autofill the
same origin in account B.

## Active context and lifecycle

The runtime authority is an active context, not a profile alone:

```text
ActiveContext
  profileKey / profileRevision
  accountKey / accountRevision
  workspaceKey
  profileEpoch
  accountEpoch
  activeContextEpoch
  connectionIntent
  Engine generation?
```

Every asynchronous continuation that can mutate state binds the required current context, including:

- Engine output/close and retry;
- connectivity and health recovery;
- AuthTransaction respond/resend/cancel;
- resource catalogue and session notice refresh;
- routing/PAC transactions;
- Browser navigation, popup, credential candidate and certificate prompt;
- download completion/error presentation;
- telemetry and log notification.

A single monotonic `activeContextEpoch` may be the implementation correlation, provided tests prove it changes
for every profile or account transition and the profile/account identities are still checked at persistence and
credential boundaries.

### Profile switch

A profile switch selects the destination profile's primary account and uses ADR-0003's persistent switch
journal. It closes/gates the old account workspace, cancels all continuations, confirms old Engine cleanup,
destroys generation credentials, validates the destination account stores/partition, then commits the new
`profileKey + accountKey` pair. Missing, disabled, deleting or corrupt primary account state leaves the new
profile selected but disconnected and does not decrypt a credential.

### Account switch

Multiple-account switching is disabled in the first release. The coordinator contract is nevertheless fixed:

```text
increment activeContextEpoch
  -> close Browser request gate
  -> cancel account-bound Auth/cert/credential/navigation/download continuations
  -> close old tabs/views/connections
  -> stop old Engine and confirm cleanup
  -> destroy proxy sidecar/generation secrets
  -> clear account session/resources/notices
  -> validate destination account stores and partition
  -> commit active profile/account pair
  -> optionally authenticate/connect
```

An account switch never migrates a live Gateway session, Cookie, MFA transaction, transport token, server
resource grant or Browser tab. Unconfirmed cleanup blocks the destination account. The coordinator does not
decrement epochs or silently reopen the old workspace.

### Persistent switch recovery

The owner-only active-context journal records old/new profile and account keys/revisions, the intended context
epoch, Engine stop result, destination validation result and one commit marker. `activeProfileId` and
`activeAccountKey` become authoritative together at the single commit point. On crash recovery:

- a proven pre-commit journal restores the all-old context;
- a proven committed journal activates the all-new context;
- ambiguous/corrupt/transiently unreadable state starts no Engine and opens no Browser workspace;
- stale owned Engine cleanup completes before any credential is decrypted.

## Settings and ownership split

### Global

- active profile/account reference;
- product locale, close behavior, start-at-login and updater state;
- one loopback listener port and strict local-proxy authentication policy.

### Profile

- immutable deployment reference/revision;
- reviewed profile defaults and bounded local profile presentation;
- primary account key;
- profile availability/confirmation state.

### Account/workspace

- auto-connect/reconnect and retry preference;
- encrypted VPN identity/credential;
- site credentials and certificate grants;
- user routing rules and local resources;
- favorites/recent resource handles;
- account Browser preferences and diagnostics.

Profile defaults may seed a new account once; later profile updates do not overwrite mutable account choices or
copy account data.

## Migration from the current flat HKUST layout

P3 creates the account hierarchy immediately; there is no intermediate production layout with mutable user
state directly under `profiles/<profileKey>/`.

Migration order:

1. finish the existing `credential-settings-transaction.json` recovery before reading settings or credential;
2. generate and journal one HKUST opaque `profileKey`, primary `accountKey` and `workspaceKey`;
3. snapshot/digest all old and destination paths;
4. write global settings and HKUST profile metadata, including the primary account reference;
5. atomically decrypt the old username/password pair in memory and re-encrypt one bound
   `VpnCredentialEnvelope` under the primary account;
6. move custom resources, routing rules/PAC, site credential vault, certificate trust and log into that account;
7. initialize empty favorites/recent documents and adopt the legacy HKUST Browser partition alias;
8. fsync destination files/directories and write the migration commit marker;
9. apply ADR-0003's post-commit retirement rules for legacy pins, rules/PAC and website vault;
10. retain/retire the legacy VPN rollback blob only through its account-bound
    `LegacyCredentialRollbackState`.

After journal recovery, state is all-old or all-new. The new profile/account pair is not visible as active until
its credential envelope binding and every authoritative account store can be verified. A corrupt authorization
store fails closed; historical backup cannot resurrect a revoked pin/direct rule.

The one-release rollback adapter binds the retained VPN blob to the exact migrated profile/account/origin/family
and never reads it for ordinary auto-connect. Any successful credential mutation retires it as required by
ADR-0003. Rollback may reuse the legacy HKUST Browser partition but never retired certificate, routing or site
credential stores.

## Logout, reset and deletion

These operations are deliberately distinct:

- **Logout / clear VPN credential** stops the account Engine/session and removes the VPN credential envelope.
  It retains Browser partition, favorites, recent entries, local resources, site credentials, pins and routing
  unless the user separately chooses workspace clearing. It also retires the legacy rollback blob before
  reporting success.
- **Clear workspace** requires an inactive account and clears the Browser partition, site vault, pins, local
  resources, favorites/recent and user routes. It does not remove the profile or VPN credential unless
  explicitly combined in one separately journaled reset operation.
- **Remove account** is disabled for the only primary account in the first release, except as part of allowed
  custom-profile deletion. Future account removal requires it to be inactive, tombstones it first, clears its
  partition and all account files, fsyncs deletion, then removes the account registry entry last.
- **Delete custom profile** follows ADR-0003 and recursively removes/tombstones every account workspace before
  removing the profile record. Builtin HKUST cannot enter this API. Failure leaves a non-connectable,
  non-auto-connect tombstone; no partial account can be rediscovered as primary.

Chromium partition cleanup failure blocks account/profile removal. A deleted account key and workspace key are
never reused.

## Session, resources and routing

The Rust `AuthenticatedGatewaySession`, MFA transaction, Modern token, Data Plane, DNS result and Engine
generation belong to one `CampusAccount` active context. They cannot be transferred between accounts, even
when both accounts share a Gateway origin.

Profile-reviewed builtin resources are immutable deployment input. Authenticated server resources bind account
key + authenticated-session generation + catalogue revision/expiry. Local resources, favorites and recent
entries belong to the workspace. Renderer sees sanitized resource views and non-authorizing opaque
`resourceHandle` values, never raw authorization fields, Cookie-bearing URLs or hidden query parameters.
`LaunchHandle` remains Main-owned and is prepared/consumed only after an explicit launch request; it never enters
Renderer state.

Routing policy compilation combines profile reviewed defaults with only the active account's custom resources
and user rules. `RoutingPolicyIR` and its decision envelope include profile/account revisions and active-context
epoch. No account's direct rule, PAC source or inherited navigation route is visible in another workspace.

## Renderer and IPC boundary

Only bounded views cross from Main:

```text
SchoolProfileView
CampusAccountView
WorkspaceView
  favorite/recent/resource display views
  route/certificate summaries
  connection/capability presentation
```

The Renderer never receives:

- VPN password or decrypted username record;
- secure-storage ciphertext;
- Gateway Cookie, CSRF, TwfID, token or MFA continuation;
- raw profile/config/DNS/provider state;
- site-vault password;
- complete Browser history or sensitive URL query/fragment;
- filesystem/partition keys or paths.

Every mutating IPC carries an opaque current account/workspace correlation generated by Main and is revalidated
against the sender, active-context epoch and store owner. Renderer-supplied profile/account/path values never
select a credential file.

The correlation is `accountHandle`, never `accountKey` or `workspaceKey`. Handles are recreated after Renderer
reload and invalidated on any context transition.

## Logging and privacy

Account logs remain three-day bounded and redacted. Default diagnostics may record opaque profile/account
correlation, protocol family, connection generation, state transition and stable error code. They do not record
username, user label, Gateway hostname, Browser hostname, resource URL, query, Cookie, pin decision response or
credential presence detail beyond a bounded state such as `configured | missing | unavailable`.

Opening a log from the UI is explicitly scoped to the active account. Cross-account aggregate diagnostics, if
added later, expose counts/stable codes only and require user action.

## Compatibility and non-goals

- ADR-0003 remains authoritative for safe custom Gateway discovery, immutable profile identity and one active
  Engine.
- Existing password + Modern L3 behavior, local proxy security and product app identity remain unchanged.
- The first release does not support concurrent Engines, account sharing, credential synchronization, cloud
  backup/export/import or account data merge.
- A profile update never copies state to another account.
- Account readiness does not claim that a Gateway permits multiple simultaneous sessions.

## Acceptance and tests

### Schema and storage

- opaque keys reject traversal, collision, symlink and hard-link substitution;
- maximum one enabled primary account per profile is enforced in the first release;
- encrypted credential binding mismatch fails before username/password use;
- branding/resource/ordinary metadata revision changes do not invalidate a credential binding;
- profile/account/workspace revisions cannot be silently coerced;
- every account-owned path is below `profiles/<profileKey>/accounts/<accountKey>/` from P3 onward.

### Isolation

Use two synthetic profiles with two synthetic accounts each, even while the production UI exposes one:

- A credential is never submitted in B account/profile context;
- Cookie/localStorage/cache/service worker/site credential/pin/rule/favorite/recent/resource state is invisible
  across accounts and profiles;
- account A server resources/notices disappear on context change;
- stale Engine, health, retry, MFA, certificate, credential, navigation, download, routing and telemetry
  callbacks cannot mutate B;
- external SOCKS/Clash/SSH always target the one active account's Campus session.

### Migration and recovery

- fault-inject every journal/write/fsync/rename/unlink/partition-cleanup boundary;
- recovery yields all-old or all-new authoritative state and is restart-idempotent;
- legacy HKUST Cookie state appears only in the migrated primary workspace;
- credential replacement/logout/account reset cannot succeed while a reusable legacy rollback blob remains;
- revoked pin/direct rule/site credential cannot reappear through rollback or downgrade;
- transient I/O never collapses into an empty store that authorizes overwrite.

### Lifecycle and deletion

- 100 profile/account context switches leave no Engine PID, port, timer, View, challenge, sidecar or borrowed
  credential;
- switch/quit/sleep/offline/crash races start no new Engine from ambiguous context;
- cleanup-unconfirmed blocks context activation;
- account/profile deletion cannot remove a registry record before partition and secret/grant cleanup;
- tombstoned accounts are never selectable, auto-connected or assigned a reused key.

### Renderer/privacy

- IPC schema rejects raw usernames, credential payloads, filesystem keys and unknown fields outside explicit
  credential-entry calls;
- account handles cannot be replayed after Renderer/context changes and never equal persistent account keys;
- no default state/log/event contains username, Gateway/Browser hostname, full URL, Cookie, token or OTP;
- favorites/recent persistence strips query/fragment and bounds all display data;
- Browser certificate pin and site credential remain exact-origin plus active-account scoped.

## Rollout order

This ADR affects existing 2.0 preparation phases without adding a new user feature:

1. P1 defines `CampusAccount`, `WorkspaceScope`, opaque key and view schemas beside `SchoolProfile`.
2. P2 provider/capability composition binds runtime capability to profile plus account context.
3. P3 writes the account-nested layout and performs the one HKUST primary-account migration directly.
4. P4 implements one `ActiveContextCoordinator` for profile and future account transitions while keeping only
   HKUST primary selectable.
5. Later Browser/routing/resource work consumes `WorkspaceScope`; it does not introduce another storage move.

No second real school, custom Gateway credential entry or second production account is enabled by this ADR.
