# Architecture and module ownership

The maintained product is split at protocol and lifecycle boundaries. A vendor
change should normally require replacing one module and its fixtures, not
editing the SOCKS frontend, desktop UI, or unrelated protocol generations.

## Runtime path

| Module | Owns | Must not own |
| --- | --- | --- |
| `engine/session.rs` | Login, configuration retrieval, token lifetime, logout | Packet forwarding or local proxy policy |
| `modern.rs` | Active token and 64-byte channel-control contract | HTTP UI, DNS, or SOCKS |
| `special_tls11.rs` | Isolated vendor TLS record/handshake compatibility | General-purpose TLS or authentication |
| `engine/data_plane.rs` | Address lease and send/receive channel ownership | TCP/UDP socket semantics |
| `engine/ip_packet.rs` | Bounded IPv4 validation and stream framing | Gateway authentication |
| `engine/netstack.rs` | Userspace TCP/UDP stack, packet bridges, bounded TCP connect | Proxy parsing or DNS wire parsing |
| `engine/dns.rs` | Bounded DNS A queries through VPN UDP | Public/system DNS fallback |
| `engine/proxy.rs` | Shared destination validation plus gateway/system resolver policy | Listener lifecycle or gateway protocol |
| `engine/socks.rs` | Loopback SOCKS5 TCP CONNECT and UDP ASSOCIATE relay | HTTP parsing or gateway protocol details |
| `bin/ec-engine.rs` | Process assembly, signals, health shutdown | Protocol encoding |
| `desktop/lib/campus-browser.js` | Isolated browser session, proxy policy and safe navigation | Gateway authentication or packet formats |

The loopback SOCKS listener is the current shared frontend, not a permanent
product constraint. Additional HTTP, per-application or managed system
frontends may be added behind the same proxy policy. They must not modify
system DNS or routes by default.

## Compatibility laboratory

| Module | Purpose |
| --- | --- |
| `watch.rs` | Public gateway metadata snapshots and diffs |
| `binary_watch.rs` | Bounded official-package identity/capability observer |
| `protocol_map.rs` | Architecture-aware marker and reference mapping |
| `adapter.rs` | Version-specific legacy preface extraction and validation |
| `probe.rs` | Authorized, redacted behavioral probes |
| `config.rs` | Gateway/resource configuration parsers |
| `tunnel.rs` | Legacy state machine retained as a compatibility backend |

Compatibility observers never sit in the production packet path. Raw official
binaries, captures, live snapshots, credentials, tokens, cookies, and assigned
addresses are excluded from Git.

## Change rules

1. Detect a change with the public watcher before changing runtime code.
2. Reproduce it with an authorized official client and sanitized fixture.
3. Update the narrowest adapter or protocol backend.
4. Add a bounded offline regression fixture.
5. Pass formatting, lint, unit tests, observer comparisons, restricted
   authentication/channel canaries and approved SOCKS TCP, domain, and UDP
   canaries.
6. Keep the preceding backend until the new EasyConnect release is validated,
   then select by an explicit observed version contract.

No UI file may encode gateway packet formats. No protocol module may read a
password from disk or command-line arguments. No compatibility failure may
silently fall back to disabled certificate validation.

## Known deviation: `proxy.allow_system_dns_fallback`

`engine/dns.rs` must not own a public or system resolver, and the engine code
defaults the flag to `false` (an unresolvable proxy domain fails closed). The
shipped `config/hkustgz.json` sets it to `true`, so if the gateway ever stops
advertising an L3 DNS server the frontend silently resolves proxy domains
through the operating-system resolver instead. Campus hostnames then leave the
tunnel as plaintext DNS questions.

Before turning this off, confirm the gateway actually advertises L3 DNS: the
engine prints `Proxy DNS mode: gateway` when it does and
`Proxy DNS mode: system fallback` when the fallback is carrying real traffic.
Only the first case makes the flag dead configuration that is safe to set to
`false`.
