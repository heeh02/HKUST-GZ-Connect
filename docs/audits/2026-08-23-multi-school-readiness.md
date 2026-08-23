# HKUST(GZ) Connect multi-school readiness audit

- Production baseline: `ed47f93f6594c7ae41ef344f08fa0aa6b5c47fc2`
- Scope: current Rust Engine, Desktop, Campus Browser, data stores and packaging
- Conclusion: protocol core is mostly school-neutral; Desktop identity/data model is single-profile and must be
  corrected before a second real Gateway

## 1. Readiness summary

```text
Rust Engine multi-school readiness: high
Desktop/profile data readiness: low
Campus Browser isolation primitives: strong, currently single-profile
Safe second real school today: NO
Profile identity + data isolation foundation: GO
```

The P0 invariant is:

```text
School A credential / Cookie / certificate trust / route / Engine event
must never be usable in School B context.
```

## 2. Unique capabilities worth preserving

### Independent Rust Engine

- `independent/src/engine/provider.rs`: typed Auth/Resource/Transport capability boundary;
- `independent/src/engine/session.rs`: authenticated Gateway session separated from Modern L3;
- `auth_transaction.rs` / `auth_control.rs`: Engine-owned challenge/secret lifecycle;
- `special_tls11.rs` / `modern.rs`: independently maintained Modern transport with PKI/leaf binding;
- `netstack.rs` / `dns.rs` / `socks.rs`: userspace TCP/UDP/IP, campus DNS and loopback proxy frontend;
- cancellation, generation, bounded shutdown and typed error model.

Most Rust protocol code is deployment-neutral. Current school specificity is concentrated in engine config,
reviewed DNS/profile policy, package filename and a small number of tests/labels.

### Campus Workspace

The current Campus Browser combines capabilities not observed together in the reviewed EasyConnect static
sample or zju-connect source, and aligns with this project's isolation and ordinary-user goals:

- sandboxed multi-tab browsing;
- one persistent Session preserving Cookie/POST/SAML;
- per-domain Campus/Direct policy and user-managed rules;
- builtin/custom resources;
- encrypted exact-origin website-password vault;
- exact-origin certificate trust manager;
- MFA/OTP-safe autofill/save detection;
- request gate during Engine/policy transitions;
- no Clash requirement for ordinary users.

This should become a profile-scoped Campus Workspace, not be removed in favor of a generic proxy-only UI.

### Desktop lifecycle and integration

- authoritative connection intent/generation FSM;
- stale event/retry/health isolation;
- loopback strict proxy auth with explicit compatibility mode;
- Clash/SSH/PAC adapters;
- local redacted diagnostics and three-day retention;
- macOS/Windows/Linux build and package gates.

## 3. Current hard-coded deployment identity

### Gateway and Engine

- `desktop/main.js` fixes product/school labels and Gateway host;
- `engineConfigPath()` and package scripts expect one `hkustgz.json`;
- `independent/config/hkustgz.json` owns Gateway origin, endpoints, DNS and transport policy;
- root CLI, Keychain labels and launch identifiers are HKUST-specific;
- Engine hello/capability presentation is not derived from a selected profile/provider/frontend.

### Flat user-data namespace

Current global files include:

```text
settings.json
cred.bin
campus-credentials.json
campus-certificate-trust.json
routing-rules.json
routing.pac
campus-browser-routing.pac
engine.log
engine-owner.json
```

Adding an editable Gateway field without namespacing these stores could send a password to the wrong Gateway,
reuse Cookies/site credentials, authorize a certificate pin across schools or apply stale route/resource/event
state.

### Browser and resources

- one fixed persistent partition;
- HKUST default home/domains and direct partner rules;
- HKUST-only bundled resource catalogue;
- one CampusBrowserManager, vault, certificate store and routing store;
- HKUST-specific health targets and display text.

### Product and school branding

The current executable/app ID/updater/Keychain/userData identity and school branding are effectively one thing.
2.0 must separate stable product identity from bounded school presentation. Changing app ID and profile storage
in one release would make rollback and secure-storage migration unnecessarily risky.

## 4. Required new domain types

### SchoolProfile

A Main/Engine-owned deployment description containing stable ID/revision, bounded branding, exact Gateway
origin, closed protocol family, packaged config reference and Browser policy. It contains no credential, pin,
Cookie or user rule. Renderer sees only a bounded `SchoolProfileView`, never internal DNS/config/provider state.

### GatewayOrigin

Canonical HTTPS origin with no credentials/path/query/fragment and a destination safety policy. Origin and
protocol family are immutable profile identity; changing either creates a new opaque profile and copies no
credential, Cookie, pin, route or Browser state.

### ProtocolFamily

A closed compiled provider/backend selection. Initial production value:

```text
easyconnect-password-modern-l3-v1
```

### CapabilitySnapshot

An additive sanitized response containing compiled, selected-provider, profile-available, ingress-mode and
effective capability states. Profile metadata cannot promote unsupported code.

### ProfileRegistry and ActiveProfileContext

A packaged reviewed registry plus local custom profiles. Active context owns profile epoch, stores, Browser
partition, routing, health, resources, branding and selected Engine config.

## 5. Safe custom-domain experience

The user requirement “Other → enter domain” is supported through a credential-free probe, not automatic
password trials:

1. normalize HTTPS domain/port;
2. validate every bounded CNAME/A/AAAA result and reject mixed/unsafe address sets;
3. connect to a validated address while preserving the original hostname for SNI/PKI and verify the peer;
4. use a bounded one-shot client with no redirect, environment proxy, Cookie jar or cache;
5. classify only a candidate public login surface, not L3/DNS/transport capability;
6. show exact origin/version/compatibility and issue a short-lived Main-owned confirmation;
7. consume it once to create an opaque isolated local profile;
8. validate profile/origin/provider/config/credential binding before decrypting the password.

The validated connector must cover all custom-profile outer Gateway HTTP and special-TLS sockets. Private
campus targets carried inside the authenticated L3 tunnel remain a separate destination policy domain.

Unsupported/unknown Gateways receive a sanitized compatibility report. Custom profiles are marked unverified
and default to an app-owned neutral page, Engine-native health only, no DNS fallback, routes, resources, updater
or system mutation.

## 6. Data migration and isolation

Move global settings/proxy/update state into `global/` and profile data into an opaque profile-key directory.
HKUST becomes the default profile and retains the existing Browser partition alias.

The migration requires a journal and fault injection around every write, fsync, rename and unlink. It must be
idempotent and yield all-old or all-new state, with no credential loss, username/password mismatch or revoked
pin resurrection.

Every continuation binds:

```text
connection intent + profile epoch + Engine generation
```

Profile switching has a durable journal and one activation commit point. It gates Browser traffic, cancels old
continuations, confirms Engine cleanup, clears sidecar/server state and validates new stores/partition before
committing `activeProfileId`. Cleanup or recovery uncertainty starts no Engine.

## 7. Test requirements before a second real school

- two synthetic Gateway/profile fixtures;
- A password never reaches B Gateway;
- A Browser Cookie/storage/site credential/pin/rule/resource is invisible in B;
- A late Engine/health/retry/MFA/route callback cannot update B;
- 100 profile switches leave zero PID/port/timer/view/sidecar residue;
- custom discovery sends no credential and rejects invalid TLS/origin/protocol;
- DNS rebinding/mixed-result/peer-mismatch and confirmation-replay tests;
- probe Cookies/session state never enter authentication;
- profile/config/binding validation happens before credential decryption;
- migration fault matrix proves all-old/all-new and restart idempotence;
- profile-aware JS/PAC/Rust routing differential corpus;
- exact packaged profile/config/asset manifest on three platforms;
- HKUST password/Modern L3/Campus Workspace regression remains unchanged.

## 8. Recommended foundation order

1. ADR/schema for SchoolProfile, GatewayOrigin, ProtocolFamily and capability truth;
2. packaged registry with one HKUST compatibility profile;
3. provider composition bound to profile identity;
4. profile-scoped storage and journaled migration;
5. ActiveProfileCoordinator and Browser partition isolation;
6. safe Gateway dialer and one-shot confirmation transaction;
7. school picker and credential-free custom Gateway probe;
8. profile-scoped RoutingPolicyIR;
9. only then add a second real school or production Router/Exit capability.

The exact security decisions are recorded in
[`ADR-0003`](../adr/0003-multi-school-profile-and-custom-gateway.md).
