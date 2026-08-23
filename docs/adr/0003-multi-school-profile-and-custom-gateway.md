# ADR-0003: Multi-school profiles and custom Gateway onboarding

- Status: Proposed for 2.0 preparation
- Decision owner: project maintainer
- Production activation: not authorized by this ADR alone

## Context

The current application has one HKUST(GZ) Gateway, account, Engine config, Browser partition, routing store,
credential vault and branding context. Replacing constants with a text field would create severe confused-deputy
risks: one school's password, Cookies, certificate pins or routes could be used against another Gateway.

2.0 must allow:

1. a reviewed HKUST(GZ) preset;
2. future reviewed school presets;
3. later, an Advanced `Other` flow where the user enters a Gateway domain/port locally.

The ordinary selector initially shows reviewed profiles only. The P5 connector foundation is implemented first,
a second reviewed school proves profile/account isolation in P10, and only P11 may expose `Other` as experimental
and unverified.

Entering a domain must be simple, but it must not cause the application to guess protocol endpoints and submit
credentials automatically.

## Decision

Adopt one active `SchoolProfile` at a time. Each profile owns an exact `GatewayOrigin`, closed
`ProtocolFamily`, Browser/routing policy and an isolated data namespace.

User identity and Browser/workspace data are further scoped by `CampusAccount` and `WorkspaceScope` under
[`ADR-0004`](0004-profile-account-workspace-scope.md). This ADR owns deployment/Gateway trust; ADR-0004 owns
same-school account separation.

### Product identity versus school branding

The application has one stable product identity for executable, updater, safeStorage/Keychain and userData.
School name/logo/theme are bounded runtime presentation values.

The final neutral product name and app ID migration require a separate branding/OS-identity ADR. Multi-school
storage migration must not be combined with an app-ID/Keychain identity change.

### SchoolProfile

```text
SchoolProfileInternal
  schemaVersion
  profileId
  profileRevision
  evidenceClass: builtin-reviewed | custom-local

  branding
    localizedSchoolName
    shortName
    bundledAssetKey?
    constrainedTheme?

  gateway
    GatewayOrigin
    ProtocolFamily
    engineConfigRef?

  browser
    homeUrl?
    campusDomains[]
    directPartnerDomains[]
    builtinResources[]
    healthTargets[]

  policy
    reviewedPrivateGatewayAllowed
    reviewedDnsFallback[]

SchoolProfileView
  profileId / profileRevision / evidenceClass
  localizedSchoolName / shortName / bundledAssetKey?
  normalizedGatewayOrigin
  sanitizedCompatibility
```

Profile safety:

- `profileId` is a registry-created ASCII slug or opaque hash, never raw user input;
- paths, HTML, CSS, JavaScript and arbitrary asset URLs are forbidden;
- `engineConfigRef` can reference only a packaged manifest entry;
- profile capability expectations cannot enable unsupported code;
- no username, password, Cookie, pin or user rule appears in a profile;
- custom profiles cannot provide private DNS fallback, system mutation or Gateway-driven updates;
- only `SchoolProfileView` may cross into a Renderer. Engine config references, private DNS, health targets and
  internal policy remain in Main/Rust;
- a `custom-local` profile always carries a visible **Unverified custom Gateway** badge. A user label cannot
  claim reviewed/official status or select a school logo.

### GatewayOrigin

```text
GatewayOrigin
  scheme = https
  normalized ASCII hostname or explicitly reviewed IP literal
  explicit/default port
  root path only
  no username/password/query/fragment
```

Default destination policy rejects loopback, link-local, multicast and unspecified targets. A reviewed built-in
profile may explicitly allow a private Gateway. A local custom profile does not receive that exception by
default.

`GatewayOrigin` and `ProtocolFamily` are immutable after profile creation. Entering a different origin/port or
choosing another family creates a new random/opaque profile ID and a new data namespace; it never mutates or
copies the old profile. This makes credential re-consent structural rather than a best-effort flag.

The first family accepts only an HTTPS origin at `/`. A Gateway deployed under a URL path is reported as
unsupported until a separately reviewed protocol variant defines path joining, redirect and origin-binding
semantics. The UI accepts only `host[:port]`, not a URL path.

### ProtocolFamily

Profiles select only closed compiled variants, beginning with:

```text
easyconnect-password-modern-l3-v1
```

Future variants are added only with provider/backend code and evidence. A JSON string cannot dynamically load
a Rust provider, endpoint script or plugin.

### PublicProbeSpec

Gateway discovery has a closed compiled request contract; it is not inferred from user input or profile JSON:

```text
PublicProbeSpec
  probeFamilyId
  exact root-bound relative path
  method = GET | HEAD
  fixed non-secret headers
  redirect = deny
  cookieStore = none
  status/contentType/bodySize/deadline bounds
  sanitized response classifier
  maximum candidate attempts
```

P11 compiles exactly one reviewed EasyConnect public probe spec. Custom/profile data cannot provide
its path, method, headers, parser or candidate list. Future families add a separately reviewed compiled spec and
synthetic fixture. A probe result identifies only a candidate public authentication surface; the
`ProtocolFamily` factory independently constructs credential-bearing endpoints after confirmation.

## Advanced custom Gateway onboarding (P11)

Proposed login surface:

```text
Campus Connect · Advanced settings

School / Organization   [ HKUST(GZ) ▾ ]

When Other is selected:
School label (optional) [________________]
Gateway domain / port   [vpn.example.edu:443]
                        [Check compatibility]

Compatibility
  HTTPS identity: valid / invalid
  Public auth surface: recognized candidate / unsupported / unknown
  Tunnel capability: requires authenticated runtime confirmation
  Reported version: sanitized value

                        [Confirm this Gateway]

Account                 [________________]
Password                [________________]
                        [Connect]
```

Credential fields remain hidden/disabled until compatibility and explicit Gateway confirmation succeed.

The `Other` flow is:

```text
enter school label (optional) + Gateway domain/port
  → canonicalize HTTPS GatewayOrigin
  → credential-free bounded GatewayProbeDialer
  → resolve and validate every bounded CNAME/A/AAAA answer
  → bind the socket to one validated address while retaining hostname SNI/PKI
  → verify the connected peer address equals the pinned address
  → standard PKI/hostname verification
  → no redirect / no environment proxy / bounded body and timeout
  → classify only a recognized public authentication surface
  → destroy the one-shot probe client and all probe Cookies
  → show normalized origin, reported version and candidate family
  → explicit user confirmation
  → consume a Main-owned confirmation nonce
  → create a custom-local profile + primary account workspace with new opaque IDs and isolated stores
  → only then show username/password
```

Rules:

- no password is sent during discovery;
- no automatic trial of multiple credential-bearing providers;
- unknown/aTrust-only/new protocol returns a sanitized compatibility report and remains unsupported;
- certificate failure is not bypassed; a Browser certificate pin cannot authorize Gateway TLS;
- discovery output never contains raw response bodies, Cookies, tokens or internal resource targets;
- a failed probe can be saved only as an inactive local draft without credentials or auto-connect;
- the probe uses a fresh client with Cookie persistence disabled. Its socket, resolver result, response buffer
  and any `Set-Cookie` state are destroyed and never promoted into `GatewaySession`;
- every bounded CNAME hop and all resolved IPv4/IPv6 answers must pass the destination policy. Mixed
  public/private answers, loopback, link-local, multicast, unspecified and IPv4-mapped unsafe addresses fail
  closed; the connector uses the validated address directly and verifies the actual peer address matches it;
- every credential-bearing Gateway connection resolves through the same reviewed dial boundary again. DNS
  rebinding after confirmation cannot turn a public custom Gateway into a private/local destination;
- public discovery proves only a candidate authentication surface. It cannot claim Modern L3, WebVPN, campus
  DNS or resource availability; those remain unknown until an authenticated runtime `CapabilitySnapshot`;
- Main returns a one-use, short-lived `GatewayConfirmation` bound to nonce + exact origin + candidate family +
  draft opaque profile identity + probe time. Editing any field, expiry, replay, Renderer restart or
  profile-switch invalidates it;
- profile creation consumes that exact confirmation. The Renderer cannot authorize a different origin with a
  previously displayed success boolean.

This preserves the requested “Other → enter domain” experience without turning the login page into an SSRF or
credential-forwarding oracle.

### Credential-bearing launch boundary

Before reading or decrypting a VPN credential, Main must complete this exact order:

```text
snapshot active profile/account + active-context epoch
  → registry lookup and schema/hash validation
  → canonical GatewayOrigin and destination policy
  → closed ProtocolFamily factory selection
  → build/validate Engine launch config
  → prove config origin/family/profile/account credential revisions match the credential binding
  → revalidate custom Gateway address policy
  → only now decrypt the bound credential
  → synchronously spawn the matching Engine generation
```

Custom profiles cannot provide arbitrary endpoint JSON. The compiled `ProtocolFamily` factory constructs an
owner-only Engine config from the confirmed origin and one reviewed fixed endpoint template. The config is
bounded, fsynced and bound to profile ID/revision; a mismatch fails before credential decryption. Custom
profiles receive no reviewed static DNS fallback, routes, resources, updater or system mutation. Authenticated
Gateway-provided DNS may be accepted only through the selected provider's existing verified parser/policy.

Every outer Gateway socket used by a custom profile—discovery, authentication, configuration, authenticated
resource retrieval, logout, session keepalive/update, token, address-control, send and receive—must use the same
`GatewayConnectorGeneration`. Any authenticated server-provided outer endpoint is canonicalized and passes the
same public-address/peer-binding policy before a socket is opened. A custom profile cannot use server
configuration to expand the outer underlay to a private or local destination. Campus/private destinations
carried *inside* the authenticated L3 tunnel are a separate policy domain and are not rejected by this
outer-Gateway rule.

## ProfileRegistry

Initial registry is packaged and read-only:

```text
profiles/
  manifest.json
  hkustgz/
    school-profile.json
    engine-config.json
    branding assets
```

Custom profiles are local user records and do not become trusted presets. Community submissions require code
review and school-specific evidence before entering the packaged registry.

The registry merges packaged reviewed profiles with owner-only local custom records, but never upgrades a local
record's `custom-local` evidence class. Custom profile IDs are random opaque values; `custom-local` is a trust
class, not a shared profile ID.

A future online registry requires a separate ADR covering detached signatures, pinned signing key, expiry,
rollback protection, origin-change re-consent and offline packaged fallback.

## Data isolation

```text
userData/
  global/
    settings.json
    proxy-credential.bin
    proxy-helper-credential.txt
    engine-owner.json
    update-state.json

  profiles/<opaqueProfileKey>/
    profile-settings.json
    profile-state.json
    accounts/<opaqueAccountKey>/
      account.json
      vpn-credential.bin
      credential-transaction.json
      deletion-tombstone.json?
      workspace/
        workspace-state.json
        campus-credentials.json
        campus-certificate-trust.json
        local-resources.json
        favorites.json
        recent-resources.json
        routing-rules.json
        routing.pac
        browser-routing.pac
        engine.log
```

VPN credentials bind to:

```text
profileId + profileCredentialBindingRevision + GatewayOrigin + ProtocolFamily
+ opaque accountKey + accountCredentialRevision
```

Website credentials and certificate pins bind to profile + account + exact HTTPS origin. Server resources bind
to profile and authenticated-session generation; user views/favorites/recent bind to account workspace.

Only one profile/account/Engine may be active in the first multi-school release. Account/workspace storage and
switching follow ADR-0004.

`SchoolProfileInternal` is never serialized wholesale to UI state or logs. Renderer state uses
`SchoolProfileView`; default diagnostics use only an opaque profile correlation ID, evidence class, protocol
family and stable error code. Gateway hostnames, private DNS and health targets do not enter default logs.

## Browser partition

Each account workspace owns a persistent partition derived from bounded opaque profile/account keys. Raw IDs are
not placed in partition paths.

HKUST `primary` retains the existing `persist:hkustgz-campus-browser` partition as a compatibility alias,
preserving Cookies/localStorage/SSO without copying Browser data. No other profile/account sees this partition.

Within one account workspace, Campus and Direct continue to share one partition for Cookie/POST/SAML continuity.
Across profiles or accounts, Cookies, storage, password vault and certificate trust are strictly isolated.

## Active context switch transaction

```text
increment active context epoch
  → close Browser request gate
  → cancel auth/certificate/credential/navigation continuations
  → close old account workspace tabs/views/connections
  → stop old Engine and confirm cleanup
  → destroy proxy sidecar/generation secrets
  → clear old account server resources/notices
  → validate destination profile + primary account + workspace
  → atomically commit exact profile/account pair
  → optionally connect the destination account
```

Every continuation binds connection intent + active-context epoch + Engine generation and is checked against the
exact profile/account pair. Old Engine closes, health probes, retries, route transactions and MFA responses
cannot affect the new context.

If old Engine cleanup is unconfirmed, switching fails closed and no new Engine starts on the same port.

Activation uses ADR-0004's owner-only switch journal. It records old/new opaque profile and account identities,
revisions/epochs, stop result, store validation and final commit marker. Active profile and account become
authoritative together only after cleanup and destination validation. Crash uncertainty starts no Engine or
Browser workspace; an in-memory profile/account epoch is never crash authority.

If cleanup fails after the epoch advances, the old Browser remains gated and the new profile is not activated.
The coordinator does not decrement the epoch or silently resume the old profile; the user may retry cleanup or
quit.

## Legacy HKUST migration

The first migration creates built-in `hkustgz` plus its `primary` account/workspace while preserving current
behavior and data. ADR-0004 is authoritative for account paths and credential envelopes.

Order:

1. finish existing credential/settings journal recovery;
2. create a new migration journal with old/new paths and digests;
3. write global settings, HKUST profile metadata and the primary account reference;
4. decrypt old VPN credential only in memory and re-encrypt into the primary account envelope;
5. move routing, website passwords, certificate trust and custom resources into the primary workspace;
6. retain the legacy Browser partition alias for that primary workspace only;
7. fsync and commit the migration marker;
8. retain the old encrypted VPN credential for exactly one release as the sole legacy rollback secret; mark it
   imported so the new path cannot import it twice;
9. durably retire the old certificate trust file and backup, routing rules/PAC and website-credential vault at
   commit. These authorization/secret stores are never rollback sources;
10. keep only non-authorizing legacy settings/resources as one-release rollback input, then remove them with
    the retained encrypted VPN credential in a later version.

Migration is idempotent and fault-injected. It must never create a username/password mismatch, lose a proven
credential, restore a revoked certificate pin or copy HKUST data into every profile.

The rollback strategy is therefore singular: before the migration commit, recovery restores the complete old
layout; after commit, the new HKUST profile is authoritative. A one-release legacy adapter may use only the
retained encrypted VPN credential and existing HKUST Browser partition. It does not restore old certificate
pins, direct-route grants or website credentials. Losing a historical authorization grant is safer than
resurrecting one the user revoked. "All-old/all-new" is evaluated after journal recovery, not between individual
filesystem renames.

The retained VPN blob has an owner-only `LegacyCredentialRollbackState` of `active | retired`, bound to exact
`hkustgz` profile ID, migrated primary account key, original Gateway origin, initial protocol family and
credential digest. It is never an
ordinary auto-connect fallback. Only an explicit one-release rollback adapter may read it while state is
`active` and every binding still matches.

The first successful password replacement, logout/credential-clear, account removal or HKUST profile reset must
durably retire the legacy state and unlink/fsync the old blob before reporting that credential mutation as
successful. Retirement failure fails the mutation; it cannot leave a UI-success/new-vault state with a reusable
legacy password. Crash tests cover pre-retire, unlink/fsync failure, new-vault commit, concurrent logout and
repeated restart. Any still-active rollback blob is unconditionally retired at the documented one-release
deadline.

## Custom profile homepage, health and deletion

A custom profile starts with no proactive school-controlled request fields: no homepage URL, builtin resource,
direct-partner rule, health target or static DNS fallback. New tabs show an app-owned neutral start page until
the user locally adds a resource. The existing HKUST homepage and health targets are never inherited.

With no reviewed health targets, site-based health rounds are disabled. Engine-native data-plane/lifecycle
health remains authoritative; the application never substitutes an arbitrary public hostname. User-added
resources do not automatically become health targets.

GatewayOrigin/ProtocolFamily edits create a new profile, but users may delete an inactive custom profile. A
delete transaction must reject the active/builtin profile, close and clear its Electron partition, delete VPN
and website credentials, pins, rules, PACs, resources and logs, fsync the namespace removal, and remove the
registry record last. Failure leaves an inactive non-auto-connect tombstone for retry; it never leaves a
partially deleted profile eligible for connection.

Custom profiles never own a legacy rollback credential. The built-in HKUST profile cannot enter this delete API;
its retained one-release blob is governed only by `LegacyCredentialRollbackState`. If Chromium partition cleanup
fails, the custom profile registry record remains as an inactive tombstone and cannot be removed or connected.

## Alternatives

| Alternative | Decision |
| --- | --- |
| Replace HKUST constants with one editable server field | Rejected: no credential/Browser/routing isolation |
| Automatically guess protocols by submitting the password | Rejected: credential forwarding and lockout risk |
| One Browser partition for all schools | Rejected: Cookie/site-password/pin cross-profile leak |
| One app build/app ID per school | Rejected as default: fragments updates, Keychain and maintenance |
| Signed remote profile marketplace immediately | Deferred until packaged profiles and migration are stable |
| Multiple simultaneous school tunnels | Deferred; first release permits one active profile |

## Security and privacy

- exact Gateway origin is shown before credential entry;
- standard PKI is mandatory;
- profile branding cannot inject executable content;
- custom profile defaults are minimal/fail-closed;
- secret and route files remain owner-only/ACL protected;
- only opaque profile correlation, evidence class, protocol family and stable error code enter default logs;
  Gateway hostname, full URL/query and credentials do not;
- compatibility reports are sanitized and user-reviewed before sharing.

## Rollback

Profile foundation ships behind one HKUST-compatible registry entry first. Before migration commit, journal
recovery restores the legacy layout. After commit, the new HKUST profile is authoritative; a one-release legacy
adapter may use only the retained encrypted VPN credential and Browser partition, never retired pins/rules/site
credentials. Rollback never submits a credential to a changed Gateway or merges profile namespaces.

## Evidence and acceptance

Before adding a second reviewed school:

- two profiles × two accounts prove password/Cookie/pin/rule/resource/event isolation;
- 100 profile/account switches leave no PID/port/timer/view/credential residue;
- every migration write/fsync/rename failure yields all-old or all-new state;
- legacy credential retirement is coupled to logout/password replacement/account clear and never reappears on
  restart or ordinary auto-connect;
- HKUST password/Modern L3/Campus Browser behavior remains unchanged;
- three-platform package verifier validates the exact profile manifest;
- the new school completes official parity and staff canary.

Before P11 exposes Advanced custom onboarding:

- the second reviewed school has passed the preceding gate;
- custom Gateway probe sends no credentials and rejects invalid TLS/origin/protocol;
- custom discovery/auth rejects rebinding, mixed/unsafe answers and confirmation replay; probe Cookies are never
  observed in authentication;
- public probe never advertises L3/DNS/resource support before authenticated runtime confirmation;
- no custom new-tab or health request reaches a reviewed school or arbitrary public hostname by default.
