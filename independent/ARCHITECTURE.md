# Architecture and module ownership

The maintained product is split at protocol and lifecycle boundaries. A vendor
change should normally require replacing one module and its fixtures, not
editing the SOCKS frontend, desktop UI, or unrelated protocol generations.

## Runtime path

| Module | Owns | Must not own |
| --- | --- | --- |
| `engine/session.rs` | Login, configuration retrieval, token lifetime, logout | Packet forwarding or local proxy policy |
| `modern.rs` | Active token, 64-byte channel-control contract, gateway endpoint resolution and socket setup | HTTP UI, DNS, or SOCKS |
| `special_tls11.rs` | Isolated vendor TLS record/handshake compatibility | General-purpose TLS or authentication |
| `engine/data_plane.rs` | Address lease and send/receive channel ownership | TCP/UDP socket semantics |
| `engine/ip_packet.rs` | Bounded IPv4 validation and stream framing | Gateway authentication |
| `engine/netstack.rs` | Userspace TCP/UDP stack, packet bridges, bounded TCP connect | Proxy parsing or DNS wire parsing |
| `engine/dns.rs` | Bounded DNS A queries through VPN UDP plus a TTL-bounded answer cache | Public/system DNS fallback |
| `engine/proxy.rs` | Shared destination validation plus gateway/system resolver policy | Listener lifecycle or gateway protocol |
| `engine/socks.rs` | Loopback SOCKS5 TCP CONNECT and UDP ASSOCIATE relay | HTTP parsing or gateway protocol details |
| `bin/ec-engine.rs` | Process assembly, signals, health shutdown | Protocol encoding |
| `desktop/lib/campus-browser.js` | Isolated browser session, proxy policy and safe navigation | Gateway authentication or packet formats |
| `desktop/lib/tunnel-health.js` | When to probe the tunnel and how much evidence a restart requires | Probing itself, or engine lifecycle |

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

## Latency contract

Every tunneled IPv4 packet becomes exactly one record on the gateway transport,
so a per-write delay is a per-packet delay. Three rules keep an interactive page
load from degrading into seconds of stalls, and each has a regression test:

1. A record reaches the socket in **one** write. Emitting the header separately
   creates a small segment followed by a dependent read, which Nagle plus the
   peer's delayed ACK turns into a stall of tens of milliseconds per packet.
2. Every socket in the path sets `TCP_NODELAY` — the gateway connections and the
   accepted loopback SOCKS clients.
3. Proxy name resolution is cached with a bounded TTL **and** collapsed per host
   while a query is in flight. A SOCKS5 client that resolves through the proxy
   sends the hostname on every CONNECT, so an uncached resolver multiplies one
   round trip by the number of connections a page opens — and a cache alone does
   not help the first visit, because a browser opens those connections at once.
   The in-flight leader must free its slot even when its task is dropped, or a
   cancelled lookup strands every waiter.

The userspace `smoltcp` sockets still run with Nagle enabled. The netstack fork
creates them in `socket_impl/tcp/mod.rs::new_tcp_socket` and applies only
`tcp_keep_alive_interval` and `tcp_timeout` from its `Config`, so there is no
local hook for it; adding a `tcp_nagle_enabled` field there is the upstream fix.
That path matters less than the gateway transport: its writes come from
`copy_bidirectional` and are usually a full segment already.

## Reachability contract: advertised MTU

Some campus destinations cannot be reached at all with a full-size MTU, and the
failure does not look like a network error. Observed against
`eform.hkust-gz.edu.cn` through a working tunnel:

| probe | result |
| --- | --- |
| TCP CONNECT to :443 | succeeds in 33ms |
| invalid TLS record to :443 | server replies with a 7-byte alert in 419ms |
| real TLS handshake to :443 | never completes, 3/3 attempts |
| HTTP on :80 | 301 in 77ms, including an 8 KB POST body |
| `www.hkust-gz.edu.cn` :443 | 111 KB downloaded in 1.14s |

The host is reachable and responsive; only its multi-kilobyte reply disappears.
That is a path-MTU black hole: the destination is told it may send 1460-byte
segments, the oversized packets are dropped somewhere inside the campus network,
and the ICMP notification that would let TCP discover this never arrives, so the
connection retransmits until it times out.

Confirmed by rebuilding with an advertised MTU of 1400: the same request that had
returned nothing after 40s returned `302` in 0.11s, three times out of three, and
the other campus hosts were unaffected.

`DEFAULT_STACK_MTU` is therefore below `MAX_TUNNEL_PACKET_BYTES` on purpose:

* the advertised MTU sets the segment size campus servers use, so lowering it is
  what makes these hosts reachable;
* the framing limit stays at 1500 so a full-size packet from the gateway is still
  accepted — rejecting one propagates an error that stops the receive bridge and
  takes the whole tunnel down.

Tune with `tunnel.mtu` in the engine configuration, or `HKUSTGZ_TUNNEL_MTU` for an
installed build whose bundle signature must not be disturbed. The engine prints
the value it settled on at startup.

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
