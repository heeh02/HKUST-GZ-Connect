# zju-connect source observation — 2c71a34

- Repository: <https://github.com/Mythologyli/zju-connect>
- Fixed commit: `2c71a34c17ea7ecf04c5fe862c4c315344128653`
- License: AGPL-3.0
- Observation type: public-source architecture review
- HKUST(GZ) real-environment evidence: none
- Dependency decision: no source/build/link/runtime dependency

This record distinguishes source presence, default CLI behavior and HKUST evidence. It does not treat an
upstream implementation as proof that the same capability exists on the school profile.

## Capability classification

| Area | Source observation | Default/activation observation | HKUST decision |
| --- | --- | --- | --- |
| EasyConnect auth | password, CAPTCHA, SMS, TOTP and certificate paths | password default; other paths profile/flag dependent | candidate states only; no real provider without school evidence |
| aTrust auth | password, CAS/OAuth2, SMS and bounded continuation families | protocol must be selected; not HKUST default | research-only |
| L3 transport | EasyConnect and aTrust implementations | EasyConnect default | current Rust Modern L3 remains independent oracle |
| Per-app TCP tunnel | aTrust resource-driven path | optional | not WebVPN; no HKUST evidence |
| WebVPN | no Sangfor WebVPN backend observed | N/A | cannot use upstream as a WebVPN design oracle |
| DNS | remote DNS, cache/single-flight, UDP/TCP, secondary and FakeIP | remote DNS enabled; public secondary may be automatic | borrow transport separation only; retain campus fail-closed policy |
| SOCKS/HTTP | local frontends | wildcard and unauthenticated by default | reject; retain loopback + strict auth |
| Underlay | explicit and opt-in auto interface binding | auto detect disabled | borrow ownership/generation ideas after a no-op seam |
| Multi-line | EasyConnect parsing and latency selection | enabled unless disabled | require HKUST discovery/token-portability evidence |
| TUN/FakeIP | experimental TUN, route and DNS-hijack paths | disabled unless requested | keep deferred/optional; never 2.0 default |
| Port forwarding | TCP/UDP forwarding | explicit configuration | only after a real user need and separate threat model |

## Implementation map

### Composition and configuration

- `configs/config.go` defines CLI/TOML fields and defaults;
- `init.go` parses configuration and builds global options;
- `main.go` composes the selected protocol client, underlay dialer, stack, resolver, routing dialer and local
  services.

The upstream default is EasyConnect with server/domain resources, multi-line, remote DNS, wildcard SOCKS and
HTTP listeners, plus ZJU-specific domain/private-network policy. TUN, FakeIP, DNS hijack, TCP-only tunnel and
underlay auto-detection are opt-in. Additional server routes are flag-controlled, but enabling TUN under the
default ZJU profile still injects the ZJU `10/8` route even when the generic `add-route` flag is false.

2.0 may borrow composition by selected profile/protocol/backend/frontend. It rejects whole-config overwrite,
secret-bearing CLI/TOML and deployment-specific defaults.

### EasyConnect authentication and session

Primary locations are `client/easyconnect` request, parse, protocol and client modules.

Observed flow:

```text
request TwfID / discovery
  → password configuration and RSA/CSRF login
  → optional CAPTCHA/secondary state
  → token from the special HTTPS/TLS session
  → address-control request
  → send and receive channels
```

Separate source paths exist for SMS, TOTP and certificate flows. Multi-line configuration can select another
endpoint and restart login. Session keepalive periodically invokes the EasyConnect session update path.

Migration decision:

- keep current Rust `GatewaySession`, `AuthenticatedGatewaySession`, AuthTransaction and Modern L3 backend;
- implement each observed secondary method as an Engine-owned provider transaction;
- never copy fixed secondary numeric mappings, endpoints, raw response errors, terminal input or TLS bypass;
- multi-line requires endpoint/auth/token-portability evidence and a generation-bound `EndpointSet`.

### EasyConnect resource and L3 data plane

The upstream resource parser reads server configuration/resource documents into domain/IP/port/protocol rules,
static DNS data and DNS server candidates. `L3Conn` owns independent send/receive channel recreation over the
special transport.

Useful ideas are typed terminal/retry causes and resource-aware routing input. Rejected behavior includes
panic-prone parser assumptions, recursive relogin and assuming that tokens survive line changes.

### aTrust authentication

Primary locations are `client/atrust/auth` and the aTrust client setup path.

The implementation has `Session`, `LoginMethod`, discovered auth info and method-specific password, CAS/OAuth2
and SMS flows. A bounded continuation loop handles multiple generic challenge families, device binding and
enhanced/access checks.

Useful idea: provider-owned opaque continuation with a hard step budget. Rejected behavior: TLS verification
bypass, continue-after-anti-MITM failure, persisted ordinary-file Cookie/device state, terminal/browser hybrids
without a private control API, and sensitive logging.

Static source presence does not prove that HKUST or any custom profile supports aTrust.

### aTrust resources, L3 and per-application TCP tunnel

Resource parsing accepts L3VPN access-model entries and ignores WEB resources. It builds domain/IP/port policy,
DNS policy and node groups. L3 tunnels own per-group connections, flow authentication, heartbeat, reconnect and
node refresh. A separate resource-selected TCP tunnel performs application/node/destination authorization.

The data path also constructs fixed trusted-process/environment attributes. That behavior can amount to
terminal-compliance impersonation and is explicitly prohibited in this project.

If a future school proves aTrust support, implement it as a separate Auth/Resource/Transport family without
changing EasyConnect Modern L3. No aTrust endpoint, field or compliance attribute enters a neutral profile.

### DNS and cache

`resolve.Resolver`, its cache/domain-resource index, IP pool and local DNS service implement:

- normalized host/resource matching;
- static records and positive cache;
- single-flight remote lookups;
- UDP with delayed/concurrent TCP fallback and temporary TCP preference;
- secondary resolver fallback;
- optional FakeIP mapping.

The broadly useful parts are single-flight, cache ownership and UDP/TCP transport health. The upstream automatic
public secondary resolver and later hostname Direct fallback can leak/misresolve split-horizon campus names and
are rejected. Campus DNS remains profile-owned and fail-closed; Direct uses a separate resolver.

### SOCKS, HTTP and forwarding

`service` contains SOCKS, HTTP CONNECT/forward, TCP/UDP forwarding, Shadowsocks and keepalive services.

- SOCKS is provided by a dependency and defaults to wildcard/no-auth;
- HTTP supports CONNECT and ordinary forwarding but has no authentication by default;
- UDP forwarding has explicit session, queue, memory, idle and cleanup bounds;
- TCP forwarding and several listener paths use process-level panic/error behavior.

2.0 keeps the current loopback strict-auth SOCKS/HTTP implementation. It may independently borrow bounded
queue/session ownership tests. Port forwarding is an optional authenticated profile-bound Ingress, not
EasyConnect protocol parity.

### Routing and Direct behavior

The upstream `dial.Dialer` receives domain/IP resource context, matches protocol/port and chooses VPN, aTrust
TCP tunnel or Direct. Unknown/IPv6/unsupported paths and some DNS failures can fall through Direct; a configured
external Direct proxy is also possible.

2.0 instead produces an explicit profile-scoped RoutingPolicyIR decision. Campus DNS/resource failures never
become Direct. Direct resolution/dialing remains separate from Gateway Underlay.

### Gateway underlay

`internal/underlay.Dialer` supports explicit interface binding and opt-in default-interface detection on
macOS, Linux and Windows. It can exclude the virtual address and refresh the selected interface after failure.

2.0 borrows the ownership/generation concept only. It first introduces a behavior-preserving
`SystemDefaultGatewayUnderlay` spanning discovery/auth/config/resource/logout/token and all data sockets. Later
explicit binding fails closed and never weakens TLS hostname/leaf binding.

### TUN, FakeIP and system mutation

The TUN stack integrates raw IPv4, optional route injection, UDP/53 hijack and FakeIP mapping. Platform code
modifies macOS/Linux/Windows routes and DNS and requires elevated privileges; cleanup and IPv6 coverage vary.

This is a platform Ingress, not a protocol feature. It remains deferred until a real unmet use case, separate
ADR, signed/reversible component and 100-cycle before/after residue evidence exist.

### Keepalive and reconnect

EasyConnect updates its session periodically and recreates L3 channels. aTrust owns heartbeat, flow auth,
connection groups, node refresh and reconnect. Generic keepalive may query a public hostname through remote
DNS.

2.0 borrows owner/single-flight/activity/miss concepts, but timers belong to profile epoch + connection intent
+ Engine generation and use bounded backoff/jitter. Public-host DNS keepalive, infinite fixed retry and global
process hooks are rejected.

### Mobile/Android

The mobile wrapper exposes a small password-only EasyConnect login and external TUN-fd adapter. It omits most
desktop authentication/resource/policy behavior and collapses errors.

It is not a cross-platform template. Mobile requires a separate credential, structured-error, OS VPN and store
policy project after desktop provider/profile boundaries stabilize.

## Design ideas worth independently implementing

1. A centralized dial/underlay owner for gateway sockets.
2. DNS wire/cache/single-flight and transport separation.
3. Opaque, bounded continuation-style authentication state.
4. Endpoint set, stickiness, failure history and hysteresis concepts.
5. Typed separation between L3, per-application tunnel and local ingress.

## Behaviors explicitly rejected

- `InsecureSkipVerify` or continue-after-anti-MITM-failure behavior;
- public/secondary fallback for split-horizon campus names;
- wildcard unauthenticated local proxy listeners;
- ZJU-specific routes/domains;
- secrets in argv, TOML, stdout, logs or ordinary persisted client data;
- TUN/FakeIP/DNS hijack and system route mutation as defaults;
- PCAP/TLS-key-log product paths;
- direct source translation or copying upstream fixtures.

## Test and CI evidence limits

Static inventory at this commit contains 33 Go test files, 224 `Test*` functions and six benchmarks. The
current audit environment did not have Go installed, so none were executed. Upstream CI builds multiple
architectures but does not gate `go test`, vet, lint or vulnerability scanning; a green upstream build is not
protocol/security regression proof.

## Delta from the previous fixed review

Compared with `4c4b41fee599646efc1463ecf080590724b24f28`, current `main` is one commit ahead. The delta is
documentation/argument alignment in README/config/entrypoint files; no protocol architecture change was
observed in that delta. Future observations must still re-fix the exact upstream commit.
