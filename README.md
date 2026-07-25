# HKUST(GZ) Connect

HKUST(GZ) EasyConnect-compatible client implemented with an independent,
modular Rust engine.

The maintained runtime does not download, execute, link, or embed
`zju-connect`. Protocol compatibility is derived from authorized analysis of
official EasyConnect packages, documented black-box validation, and a
license-recorded historical reference review. Official vendor binaries and
test credentials are never committed.

## Current status

The Rust engine has passed an approved end-to-end test:

- password authentication;
- verified modern session-token derivation;
- TLS 1.1/RSA/RC4-SHA compatibility transport;
- address-control, send, and receive channels;
- IPv4 packet framing;
- userspace TCP/IP;
- VPN-side DNS;
- loopback SOCKS5;
- SSH banner retrieval from the repository's approved campus test endpoint;
- clean logout.

The proprietary gateway still forces obsolete TLS 1.1/RC4 cryptography.
Certificate verification, Finished verification, and record MAC validation
remain mandatory; there is no insecure switch.

## Modular architecture

```text
CLI / Electron
    -> engine/session.rs       authentication and session lifetime
    -> modern.rs               token and 64-byte control contract
    -> special_tls11.rs        isolated vendor TLS compatibility backend
    -> engine/data_plane.rs    address, send, receive channel ownership
    -> engine/ip_packet.rs     bounded IPv4 validation and framing
    -> engine/netstack.rs      userspace TCP/UDP stack
    -> engine/dns.rs           DNS through the VPN
    -> engine/socks.rs         loopback SOCKS5 frontend
```

Compatibility observation, official-package inspection, protocol mapping, and
runtime packet forwarding are separate modules. A vendor update should change
one adapter or transport backend rather than the UI or local proxy.

## macOS CLI

Copy the local identity template and set the username:

```bash
cp config.toml.example config.toml
./hkustgzconnect set-password
./hkustgzconnect up
./hkustgzconnect test
```

The password is read from macOS Keychain and piped to `ec-engine` on standard
input. It never appears in process arguments or a runtime configuration file.

Useful commands:

```bash
./hkustgzconnect status
./hkustgzconnect logs
./hkustgzconnect restart
./hkustgzconnect down
```

## Native Rust build

```bash
cd independent
cargo build --locked --release --bin ec-engine
cargo test --locked
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
```

Direct engine usage accepts credentials only on standard input:

```bash
printf '%s\n%s\n' "$VPN_USERNAME" "$VPN_PASSWORD" |
  independent/target/release/ec-engine \
    --config independent/config/hkustgz.json \
    --credentials-stdin \
    --socks-bind 127.0.0.1:1080
```

Do not put actual credentials in shell history; the example uses environment
placeholders only.

## Desktop

For local development:

```bash
cd desktop
bash scripts/build-engine.sh
npm ci
npm start
```

Release CI builds `ec-engine` from this repository for macOS and Windows,
packages it with the Electron UI, and never fetches an external VPN engine.
The desktop stores passwords through the operating system's protected
credential backend (macOS Keychain or Windows DPAPI). The independent 1.0
upgrade intentionally does not migrate the previous weak local credential
format, so desktop users sign in once after upgrading.

## Upgrade resistance

Daily public monitoring compares gateway metadata, Windows module policy,
official package identities, and compatibility baselines. Restricted canaries
perform authentication and empty-channel validation without business traffic.
Unknown protocol, certificate, authentication, or binary changes fail closed.

See:

- [architecture and module ownership](independent/ARCHITECTURE.md)
- [maintenance policy](independent/MAINTENANCE.md)
- [upgrade and continuity playbook](independent/UPGRADE_PLAYBOOK.md)
- [protocol specification](independent/spec/PROTOCOL.md)
- [compatibility matrix](independent/spec/COMPATIBILITY_MATRIX.md)
- [evidence log](independent/cleanroom/EVIDENCE_LOG.md)

No proprietary protocol can be guaranteed compatible forever. Continuity comes
from early detection, isolated adapters, official-client parity testing,
reproducible Rust dependencies, and a documented official-client fallback.

## Security

- TLS verification cannot be disabled.
- The SOCKS listener must bind to loopback.
- Authentication and tunnel secrets are zeroized where practical.
- Compatibility artifacts omit credentials, tokens, cookies, assigned
  addresses, raw packets, and response bodies.
- Official packages, extracted binaries, captures, live snapshots, and build
  output are ignored.
- Broader testing requires the authorization record in
  `independent/cleanroom/AUTHORIZATION_TEMPLATE.md`.

License: GPL-3.0.
