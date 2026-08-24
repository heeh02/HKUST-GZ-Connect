# ADR-0006: Production provider composition and capability reporting

- Status: Accepted P2 implementation contract
- Production activation: behavior-preserving only
- Protocol families enabled by this ADR: `easyconnect-password-modern-l3-v1`

## Context

Authentication and Modern L3 already have typed Rust provider/backend traits, but production `ec-engine` still
constructed their concrete adapters directly. Desktop also had a strict `CapabilitySnapshot` schema that was not
fed by the Engine. Adding a second provider in that state would spread protocol selection and capability claims
across process startup, session code and UI.

P2 creates a narrow composition seam without enabling another protocol or authentication method.

## Decision

### Closed production family

The private reviewed Profile binding carries one `protocolFamily`. Rust accepts only a compiled
`ProductionProviderFamily` enum. JSON cannot name a module, library, class, endpoint or plugin path.

The current mapping is exact:

```text
easyconnect-password-modern-l3-v1
  authentication = ProductionPasswordAuthProvider
  resources      = UnsupportedResourceProvider
  transport      = ModernL3TransportBackend
```

Unknown families fail as `CONFIGURATION_INVALID` before authentication network work. No dynamic plugin ABI,
`dlopen`, configuration-driven provider registry or endpoint guessing is introduced.

### One coordinator

`ProviderCoordinator<Auth, Resource, Transport>` owns one type-compatible provider set. The transport session
type must equal the authentication session type at compile time. Production and synthetic tests instantiate this
same coordinator rather than maintaining a second test-only orchestration path.

The binary's `CapabilityModel` is an upper bound. A selected provider may keep or tighten a capability to
`unavailable`/`unsupported`; it cannot promote a capability that the compiled layer lacks.

### Additive capability API

Event API v1 remains byte/schema compatible. Control API v2 adds the private, secret-free
`provider.capabilities` query and returns:

```text
profileId / profileRevision / engineGeneration
compiled capability layer
selected provider capability layer
```

The response contains every stable capability with one state: `supported`, `unsupported` or `unavailable`. It
contains no Gateway origin, username, account key, Cookie, token, endpoint, DNS target or transport material.

Desktop rejects a report whose Profile or generation does not match the active Engine. It adds the reviewed
Profile and current ingress layers, intersects all four layers, and publishes only the existing sanitized
`CapabilitySnapshot` view.

### P2 account boundary

P3—not P2—owns durable account/workspace key generation and journaled migration. Until P3 commits that state,
the single legacy primary account receives a random process-lifetime `accountHandle` and
`activeContextEpoch = 1`. Renderer may see that handle; it never sees or implies a persistent account key.

Restart changes the short-lived handle. Disconnect clears the current generation-bound capability snapshot.
P3 will replace the internal legacy binding with the journaled account key/revision while preserving the same
Renderer schema.

## Compatibility

- Password authentication requests and Modern token/Data Plane code are unchanged.
- Resource catalogue, WebVPN and every secondary authentication capability remain `unsupported`.
- Event API v1 hello remains `password`, `l3`, `udp`; P2 does not reinterpret it.
- A failed capability query is non-fatal for the password connection path and cannot downgrade TLS, DNS,
  destination safety or local proxy authentication.
- Existing CLI invocations without Control v2 retain their current behavior. Official Desktop always supplies
  the reviewed Profile binding and Control v2 stream.

## Security invariants

1. Profile `protocolFamily` is verified before provider construction.
2. Provider capability state can only tighten compiled capability state.
3. Profile and ingress claims cannot elevate compiled/provider state.
4. Stale Profile/generation reports update Renderer state zero times.
5. Persistent account/workspace keys, credentials, Cookies and tokens cross the capability API zero times.
6. Unknown/unsupported authentication remains fail-closed and performs no guessed continuation request.
7. Provider composition introduces no network listener or configuration-driven code loading.

## Verification gates

- production `ec-engine` constructs `ProductionProviderSet`, not concrete auth/transport adapters;
- synthetic auth/resource/transport providers run through `ProviderCoordinator`;
- Control v2 codec/query tests cover bounds, unknown fields, Profile/generation binding and secret-free output;
- real Electron Main E2E observes the sanitized snapshot, renderer restart retention and disconnect clearing;
- Event API v1 schema test remains unchanged;
- password-only/Modern L3, module-boundary, package and three-platform CI remain green.

## Rollback

Rollback removes the provider-set factory and additive Control v2 query while retaining the existing concrete
password/Modern implementations and Event API v1. No user data migration or persistent state is created by P2.
