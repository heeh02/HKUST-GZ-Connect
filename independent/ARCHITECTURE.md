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
