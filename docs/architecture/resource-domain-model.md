# Web resource domain model

Status: 2.0 architecture contract; no production capability is enabled by this document.

This document defines the Web resource model for the first Campus Workspace Beta. It deliberately separates:

- a resource being present in a package, local settings or an authenticated catalogue;
- the source and trust class of that resource;
- whether the current profile/account is authorized to use it;
- whether this build and current session have the required capability and Exit;
- the private material required to launch it.

None of those facts implies another. In particular, a parsed server field, an apparent SSH/HPC/Jupyter/database
type or an opaque target does not prove that HKUST(GZ), another school or the current production build supports
or should launch it.

## 1. Current evidence boundary

The current implementation has three relevant but separate foundations.

### Desktop shortcuts

`desktop/lib/campus-resources.js`, `campus-resource-store.js` and `campus-resource-ipc.js` implement a bounded
local Web-shortcut model:

```text
id / name / description / url / route(campus|direct) / builtin
```

- built-in and local resources are merged into a maximum of 32 visible entries;
- local entries are transactionally created, edited, reordered and deleted;
- built-ins are read-only;
- only HTTP(S) URLs are accepted through the Campus Browser URL normalizer;
- a Direct resource targeting a local, private or special host is forced to Campus or rejected;
- the control Renderer currently receives the resource URL;
- `CampusBrowserManager.open()` currently resolves the route and then calls `ensureConnected()` before opening,
  including for a resource labelled Direct.

This is a useful compatibility model, not the final resource domain.

### Rust catalogue parser

`independent/src/resource_catalogue.rs` and `independent/spec/RESOURCE_CATALOGUE_V1.md` provide a bounded offline
parser. It already separates a sanitized catalogue view from non-serializable `ResourceLaunchTarget` values
resolved by opaque handles. Unknown authorization values become only `declared_unverified`; they never become
allow or deny decisions.

Production still uses `UnsupportedResourceProvider`. The offline provider proves parser and redaction behavior
only. It does not prove authenticated retrieval, authorization semantics, catalogue refresh, expiry or launch.

### External integration building blocks are a separate domain

The current product provides an authenticated loopback SOCKS/HTTP frontend, generated Clash/PAC/OpenSSH
configuration and `ec-proxy-command` for an OpenSSH-style byte stream. These are External Tool Integration Center
building blocks, not resource descriptors or launchers. Their profile/account binding and transactional
export/install/update/remove contract is owned by
[`ADR-0005`](../adr/0005-external-tool-integration-center.md).

The model below preserves current Web behavior. The first Beta does not map SSH, HPC, TCP/UDP, database,
Jupyter, file, Remote Desktop or WebVPN records into typed resource launchers.

## 2. Ownership and scope

Every resource belongs to exactly one immutable scope:

```text
ResourceScope
  profileKey
  accountKey
  workspaceKey
```

- `profileKey` identifies the reviewed or local school profile;
- `accountKey` identifies one campus account without exposing its username;
- `workspaceKey` owns Browser state, favorites, recent activity and user presentation overrides.

Raw user input is never used as a path component. Moving a resource between profiles or accounts creates a new
resource identity; it does not copy server authorization, launch material, Cookies, pins or history.

The control Renderer receives only a bounded `ResourceDescriptorView`. The full descriptor and exact target
remain Main/Engine-owned. A managed Browser may eventually navigate to an exact Web target, but that target is
never returned through the ordinary resource-list IPC, telemetry or logs.

## 3. Internal descriptor

The following is a logical contract, not a claim that these exact Rust or JavaScript types already exist.

```text
ResourceDescriptorInternal
  schemaVersion
  resourceHandle
  scope: ResourceScope

  source
    kind
    providerKey?
    sourceIdentityRef

  trustClass
  resourceType

  display
    name
    description?
    category?
    tags[]
    iconKey?

  requirements
    requiredCapabilities[]
    requiredExit

  authorization
    state
    decisionAvailable
    decisionRevision?
    decisionExpiresAt?
    privateEvidenceRef?

  catalogue
    catalogueHandle
    catalogueRevision
    descriptorRevision
    sessionGeneration?
    fetchedAt?
    expiresAt?

  privateWebTarget
```

### Resource identity

`resourceHandle` is an opaque, source-namespaced identity used by views, favorites and recent activity. It is
not an authorization bearer and is not sufficient to launch anything.

- a built-in handle derives from a reviewed packaged manifest identity;
- a local handle is randomly generated and retained with the local record;
- a server handle is derived inside the provider from its private source identity plus profile/provider scope.

Raw vendor identifiers, URLs, hosts and user data never become the public handle. Reuse of a handle after a
catalogue revision does not bypass revision, expiry or authorization checks.

### Source

`ResourceSourceKind` is one of:

| Source | Meaning | Mutability |
| --- | --- | --- |
| `builtin_reviewed` | Shipped in a reviewed, packaged profile manifest | Read-only; changes with a reviewed app/profile revision |
| `authenticated_server` | Retrieved by an authenticated, evidence-backed `ResourceProvider` | Read-only to the user; session/revision/expiry bound |
| `local_user` | Entered on this computer by the user | Editable and deletable within its profile/account scope |

Sources use separate identity namespaces. A server or local record cannot override a built-in merely by copying
its ID, label or target. Equal URLs do not erase provenance; deduplication is a presentation decision and must
retain the source/trust distinction.

### Trust class

`ResourceTrustClass` describes provenance, not permission or target safety:

| Trust class | Meaning |
| --- | --- |
| `reviewed_builtin` | Manifest and target were reviewed for the packaged profile |
| `authenticated_server` | Record arrived through an authenticated provider session; its value semantics may still be unknown |
| `user_supplied` | Record was entered locally by the user |
| `unverified` | Provenance or required semantics are insufficient for a stronger label |

An authenticated server record is not automatically authorized. A reviewed built-in is still subject to current
destination, certificate, capability and Exit checks. A local-user record is not permitted to weaken those
checks.

### Resource type

The first-Beta `ResourceType` is a closed, versioned enum:

```text
web
unsupported
```

`unsupported` quarantines a bounded record whose source type has no reviewed Web mapping. It is visible only when
useful to explain why it cannot be opened and is never launchable. SSH, HPC, TCP/UDP, database, Jupyter, file,
Remote Desktop and WebVPN are not reserved first-Beta enum variants; adding one requires a later evidence-backed
schema/version and an independent product decision. Unknown values must not be guessed from names, ports or URL
shapes.

### Private Web target

`privateWebTarget` is a provider-owned, non-serializable, redacted-debug value:

```text
WebTarget  exact HTTPS/HTTP URL and intended route
```

This shape does not define a vendor wire format. It must not implement ordinary `Serialize`, `Display` or
value-bearing `Debug`. Session-bound target strings use zeroizing storage where practical. External tool adapters
never receive this target.

## 4. Renderer view

The list/search API returns only:

```text
ResourceDescriptorView
  schemaVersion
  resourceHandle
  sourceKind
  trustClass
  resourceType

  name
  description?
  category?
  tags[]
  iconKey?

  requiredCapabilities[]
  requiredExit
  authorizationState
  launchAvailability
  revisionToken
  expiresAt?

  favorite
  lastOpenedAt?
```

The view never contains:

- raw vendor identifiers or authorization fields;
- a server host, private IP, URL path, query, fragment or embedded credential;
- Cookie, token, CSRF, TwfID, session ID or transport token;
- a command line, executable path or arbitrary icon/asset URL;
- an internal provider/config reference.

Server-provided display strings are presentation-only. They are bounded, control-character-free and escaped as
text. `iconKey` resolves only to a packaged allowlisted asset. Labels, tags and handles are excluded from normal
diagnostic logs.

A local-resource editor may receive a separate `LocalResourceDraftView` containing the user's own editable
fields. That editor contract cannot be used to retrieve or mutate built-in or server launch material.

## 5. Capabilities and Exit

`requiredCapabilities` contains stable, bounded capability identifiers. The effective set is derived from the
compiled implementation, selected provider/backend, current profile and current ingress mode. Profile JSON or a
resource record cannot promote a capability to Supported.

First-Beta identifiers include:

```text
resource.catalogue
resource.authorization
frontend.campus_workspace
transport.l3
```

Only existing provider capability names are currently implemented. SSH, forwarding, file, Remote Desktop and
WebVPN identifiers are not P8 resource capabilities; future additions require a separately versioned contract.

`requiredExit` is explicit and singular:

```text
direct
campus_modern_l3
unresolved
```

There is no implicit fallback. If `campus_modern_l3` is unavailable, a resource does not become Direct.
`unresolved` is non-launchable until a reviewed Web adapter selects an exact Exit.

## 6. Authorization, revision and expiry

`ResourceAuthorizationState` is one of:

```text
not_required
not_declared
declared_unverified
allowed
denied
expired
withdrawn
unavailable
```

Rules:

- `allowed` and `denied` may be produced only by a reviewed, profile-specific authorization adapter with
  observed value semantics;
- the current offline Rust parser produces only `not_declared` or `declared_unverified`, with
  `decisionAvailable = false`;
- apparent booleans, numbers, strings or missing fields are never interpreted heuristically;
- a required decision that is unknown, unverified, unavailable or expired fails closed;
- local and built-in resources may use `not_required`, but this bypasses neither destination policy nor runtime
  capability checks;
- disconnect, profile/account switch, provider replacement or session-generation change invalidates every
  server authorization decision and launch handle tied to the old session.

Revision and expiry are source-specific:

| Source | Revision | Expiry |
| --- | --- | --- |
| Built-in | Packaged profile/app manifest revision | Valid until that reviewed manifest is replaced or withdrawn |
| Local | Owner-only settings transaction revision | No implicit expiry; revalidated on every edit and launch |
| Server | Provider catalogue + descriptor + authorization revisions | Explicit provider expiry when evidenced; otherwise session-bound and never durable authority |

The view receives only an opaque `revisionToken`. Raw server revisions and authorization evidence remain private.
An expired or superseded catalogue may preserve presentation tombstones for favorites, but cannot authorize a
launch.

## 7. Opaque LaunchHandle

`resourceHandle` identifies a resource. `LaunchHandle` authorizes one prepared launch. They are different.

A `LaunchHandle` is:

- random and non-self-describing;
- Main/Engine-owned and stored in a bounded in-memory table;
- short-lived and normally single-use;
- bound to profile, account, workspace, profile epoch, Engine generation, descriptor revision, catalogue
  revision, authorization revision, required Exit and requested action;
- invalidated by disconnect, route-policy change, profile/account switch, resource refresh, timeout, cancellation
  or first consumption;
- absent from settings, clipboard, history, crash reports, URLs and logs.

The handle encodes no target. A MACed or encrypted target blob is not a substitute for the owner-side record.

## 8. Web launcher boundary

### Components

```text
Control Renderer
  -> launch-resource(resourceHandle, action)
Trusted IPC boundary
  -> ResourceCatalogueCoordinator
  -> ResourceLaunchBroker
       -> WorkspaceWebLauncher
```

The Renderer never chooses an executable, host, port, raw URL or Exit at launch time. It chooses only the bounded
Web actions `open` or `cancel` allowed by the view.

### Launch transaction

```text
validate trusted IPC sender and exact schema
  -> snapshot active profile/account/workspace and generations
  -> resolve resourceHandle in the owning catalogue
  -> verify source, revision, expiry and authorization
  -> verify required capabilities and exact Exit
  -> resolve and validate the private target under that Exit's destination policy
  -> prepare a bounded Web LaunchHandle
  -> atomically consume the LaunchHandle
  -> execute the Workspace Web launcher
  -> record only a sanitized outcome
```

If any snapshot changes before consumption, launch fails and the caller must request a new handle. Cancellation
owns and closes every partial Browser request and temporary Web authorization material.

### Web behavior and current support boundary

| Type | Intended launcher | Current implementation fact | P8 activation rule |
| --- | --- | --- | --- |
| Web | Managed Campus Workspace under an exact route/Exit | Built-in/local Web shortcuts exist; they currently pass raw URLs and always call `ensureConnected()` | Migrate current behavior behind a handle and skip Engine connection for a validated Direct rule under the documented 1.x Chromium-DIRECT boundary; ControlledDirectExit later strengthens resolved-address ownership |
| Unsupported/unknown | None | Offline parsers may observe bounded unknown records | Show only a safe explanation when useful; open action and network sessions remain absent |

External Tool Integration Center preview/export/managed lifecycle is not a launcher row in this table. Scoped TCP/UDP
forwarding remains a post-Beta Headless capability in P13, not a P8 `ForwardLease`.

## 9. Search, favorites and recent activity

These are Workspace overlays, not fields that mutate provider descriptors.

### Search

- indexes only bounded view fields: name, description, category, tags, type and source label;
- never indexes private targets, URLs, hosts, authorization material or raw provider values;
- operates locally and does not send queries to a Gateway or analytics service;
- normalizes Unicode and locale deterministically while rendering source text escaped;
- uses stable tie-breaking so refresh does not reorder equal results unpredictably;
- may boost exact/prefix matches, favorites and recent successful launches, but not trust or authorization beyond
  their explicit filters.

### Favorites

```text
FavoriteEntry
  workspaceKey
  resourceHandle
  sourceKind
  pinnedAt
  optional user label/category override
```

Favorites contain no launch target and grant no authority. A withdrawn, denied or expired server resource remains
only as an unavailable tombstone until the user removes the favorite or the retention period expires.

### Recent activity

Recent activity records only successful, user-initiated launch completion:

```text
RecentResourceEntry
  workspaceKey
  resourceHandle
  resourceType
  sourceKind
  launchedAt
```

It is bounded by count and retention, stored owner-only and cleared with the Workspace. Failed attempts may update
aggregate diagnostics by stable error code, but do not record a target, query, hostname or secret-bearing URL.

## 10. Source-specific policy

### Built-in reviewed

- loaded only from a packaged, hash-checked profile manifest;
- read-only in the ordinary editor;
- may provide bounded branding/category/icon metadata;
- cannot contain credentials or arbitrary executable/script paths;
- is revalidated against current destination, capability and Exit policy on every launch;
- changes only through a reviewed manifest/app update and rollback contract.

### Authenticated server

- retrieved only by a production `ResourceProvider` owned by an authenticated session;
- scoped to profile, account, provider, session generation and catalogue revision;
- retains raw target and authorization material only in the provider/Engine;
- requires explicit refresh, expiry and withdrawal behavior before production activation;
- cannot overwrite built-ins or local records;
- may be displayed as `authenticated_server`, but that label never means allowed;
- cannot launch while authorization semantics are unknown when a decision is required.

### Local user

- created only through the Web exact-schema editor;
- remains Web-only during and after the first-Beta migration;
- is validated on write and again on launch;
- cannot select an unsupported capability, inject a provider ID, invent server authorization, supply an
  executable/argument list or create a non-Web resource type;
- remains isolated to one profile/account/workspace and is removed through a durable local transaction.

## 11. Error model

Launch and catalogue errors use stable, secret-free codes. Suggested categories are:

```text
RESOURCE_NOT_FOUND
RESOURCE_SCOPE_CHANGED
RESOURCE_REVISION_CHANGED
RESOURCE_CATALOGUE_EXPIRED
RESOURCE_WITHDRAWN
RESOURCE_AUTHORIZATION_UNKNOWN
RESOURCE_DENIED
RESOURCE_CAPABILITY_UNSUPPORTED
RESOURCE_CAPABILITY_UNAVAILABLE
RESOURCE_EXIT_UNAVAILABLE
RESOURCE_TARGET_REJECTED
RESOURCE_LAUNCH_HANDLE_INVALID
RESOURCE_LAUNCH_HANDLE_EXPIRED
RESOURCE_LAUNCH_CANCELLED
RESOURCE_LAUNCH_FAILED
```

Messages tell the user what action is possible: reconnect, complete authentication, refresh, request access,
change route, install/enable a reviewed feature, or contact the resource owner. Errors never echo the private
target, server response, raw authorization value or command line.

Site failure, DNS failure, Tunnel failure and authorization denial remain distinct. No error path silently sends
a Campus Web resource Direct or treats an unsupported/unknown record as launchable.

## 12. Security invariants

1. Renderer-visible lists contain no private or session-bound launch target.
2. Resource presence, trust, authorization and runtime availability are separate states.
3. A handle from Profile/Account A is unusable in B.
4. Server authorization cannot outlive its provider session, revision or expiry.
5. LaunchHandle is one-use, generation-bound and non-persistent.
6. Unknown type, capability, Exit or authorization semantics fail closed.
7. Direct and Campus L3 never silently substitute for each other.
8. Every application-owned resolved destination passes the selected Exit's post-resolution safety policy.
   P8's existing Chromium `DIRECT` route is a documented temporary exception: it keeps current literal/text host
   safety and proves zero Campus-Engine start/wait, but does not claim DNS-rebinding protection. P12 removes this
   exception by activating ControlledDirectExit.
9. The Web launcher never constructs a shell command or external-tool configuration from resource data.
10. Resource labels/targets are absent from default logs, telemetry and crash reports.
11. Profile manifests, server catalogues and local records use distinct namespaces and cannot override each
    other's trust labels.

## 13. Migration from the current simple model

Migration is behavior-preserving and journaled with the profile/account storage migration.

Migration reads two authoritative source namespaces independently:

1. every normalized packaged builtin record;
2. every normalized custom record persisted in settings, up to the current custom-storage bound of 32.

It must not use the merged visible list as migration input. The current view places six builtins first and caps
the merged result at 32, so all 32 stored custom entries can include six records that are valid but not currently
visible. Each source record maps as follows:

```text
legacy id           -> private sourceIdentityRef + new opaque resourceHandle
builtin=true        -> source=builtin_reviewed, trust=reviewed_builtin
builtin=false       -> source=local_user, trust=user_supplied
name/description    -> bounded display fields
url                 -> private WebTarget
route=campus        -> requiredExit=campus_modern_l3
route=direct        -> requiredExit=direct
type                -> web
authorization       -> not_required
revision            -> packaged-manifest or local-settings transaction revision
expiry              -> none for the migrated built-in/local record
```

Requirements:

- preserve all valid built-in and all valid stored local Web shortcuts without changing route decisions;
- preserve the current built-in-first, 32-visible compatibility view separately from the lossless stored model;
- keep the current maximum of 32 local entries until a separately measured storage/UI bound replaces it;
- make migration idempotent and all-old/all-new under write, fsync, rename and restart fault injection;
- retain the existing local editor as a Web-only compatibility adapter;
- reject non-Web local creation in the first-Beta schema; future support requires a new versioned contract;
- retain a one-release rollback input without treating old data as an alternate authorization source;
- never attempt to synthesize a server catalogue from built-in or local shortcuts.

During the compatibility phase, Main may resolve a migrated Web resource and call the existing Campus Browser
path. This preserves current behavior but does not satisfy a future claim that Direct resources open without a
Tunnel: the current manager still calls `ensureConnected()`. That improvement requires its own launcher/Exit
activation and tests.

## 14. P8 Web Resource Workspace acceptance

“P8” is the Web Resource Workspace Beta milestone in the Revision 5 execution plan. This document
defines its gates but does not itself authorize production changes.

P8 is complete only when all of the following are true.

### Domain and migration

- versioned internal/view schemas and exact enum/bounds tests exist;
- current built-in/local Web resources migrate idempotently with order, route and editability preserved;
- profile/account/workspace isolation tests show zero cross-scope resource, favorite, recent or LaunchHandle
  visibility;
- source and trust badges cannot be forged by local/server payloads;
- unknown resource types and schema versions fail closed.

### Catalogue and authorization

- production still reports resource catalogue/authorization as unsupported until authenticated retrieval,
  refresh, expiry and value semantics have evidence;
- synthetic server catalogues test revision replacement, expiry, withdrawal and authorization-unknown behavior;
- stale or expired catalogues authorize zero launches;
- the control Renderer receives no exact server target or raw authorization material.

### Search and workspace UX

- search covers Web and unsupported view presentation fields without indexing private targets;
- favorites and recent activity are profile/account/workspace scoped, bounded and durable;
- unavailable, denied, expired and unsupported resources remain distinguishable and actionable;
- keyboard navigation, bilingual labels and basic accessibility are covered by real Electron tests;
- 10,000 synthetic views remain searchable and cancellable without blocking the control window.

### Launcher

- every Web open goes through the broker transaction and a one-use LaunchHandle;
- existing Web shortcut launch behavior has packaged Electron parity after migration;
- resource refresh, profile/account switch, route revision or Engine restart invalidates an old handle;
- partial Browser resources are cleaned after cancellation and 100 repeated launch/close cycles;
- SSH, HPC, TCP/UDP, database, Jupyter, file, Remote Desktop and WebVPN expose no P8 launch action or network
  session; unknown schema presence never counts as support;
- Direct-without-Tunnel may be claimed only for the existing validated Browser Direct route after a packaged
  P8 test proves it starts/waits for the Campus Engine zero times; it does not claim ControlledDirectExit-level
  resolved-address protection before P12.

### Security and packaging

- exact IPC sender/key/length validation, secret scans and architecture cycle gates pass;
- logs, error text, diagnostics and crash paths contain zero private targets, queries, authorization values,
  LaunchHandles or credentials;
- package verification excludes synthetic catalogues, test launchers and fixture targets;
- macOS, Windows and Linux packages retain the current loopback-only, no-global-network-mutation behavior;
- no vendor authorization field, SSH/HPC/Jupyter/database target, WebVPN endpoint, Remote Desktop protocol or
  forwarding behavior is guessed.

P8 may be called the first Resource Workspace Beta only after the Web gates above and the independently defined
External Tool Integration Center gates in
[`ADR-0005`](../adr/0005-external-tool-integration-center.md) all pass. No non-Web resource launcher or scoped
forwarding capability is implied.
