# Evidence log

This file records provenance and sanitized outcomes only. It is not a
substitute for the completed authorization record.

## 2026-07-25 — production public metadata

- Target: `https://remote.hkust-gz.edu.cn`
- Reported gateway: `M7.6.8R2`
- Windows public installer SHA-256:
  `9d108bcf8775ce61e31d86fbe6e5014907f7ec3d85d8626f38d2dc898ae7203f`
- Sanitized result:
  `../baselines/hkustgz-production.json`
- Raw authentication responses and official Windows binaries were not
  committed.

## 2026-07-25 — installed official macOS client

- Bundle identifier: `com.sangfor.Easyconnect`
- Internal package version: `7.6.7.10`
- Signature authority:
  `Developer ID Application: SANGFOR Technologies Company Limited`
- Apple team identifier: `YYE5WQ4M88`
- Activities: read-only bundle inventory and static inspection of bundled web
  authentication behavior.
- User settings, logs, stored credentials, and session data were excluded.

## 2026-07-25 — approved credentialed behavior run

- One test account was supplied for this purpose; its identifier is not
  recorded here.
- Credential source: existing macOS Keychain item, piped through standard
  input. No credential appeared in process arguments.
- Result: discovery, password configuration, password login, configuration
  fetch, resource fetch, and logout all returned HTTP 200; authentication
  succeeded.
- Observed password profile: 2048-bit RSA, anti-replay challenge present,
  anti-MITM helper disabled.
- Sanitized structural result:
  `../baselines/hkustgz-auth-contract.json`
- Exact credential scan over the Git-visible file set returned zero matches.
- No raw response body, cookie value, session identifier, CSRF value, or RSA
  modulus was persisted.

## 2026-07-25 — official Linux package

- Public source:
  `https://download.sangfor.com.cn/download/product/sslvpn/pkg/linux_767/EasyConnect_x64_7_6_7_3.deb`
- Size: `62,057,642` bytes
- SHA-256:
  `ae623c6dc0354ff87afefbb770de5013bfd943051c9a653b93db708253b2f0d3`
- Public path/version label: `7.6.7.3`
- Debian control version: `7.6.7.7`
- Maintainer field: `Sangfor Technologies Inc <support@sangfor.com>`
- Container and gzip integrity checks passed before analysis.
- Sanitized binary contract:
  `../baselines/easyconnect-linux-7.6.7.3-binary.json`
- The package and extracted filesystem remain ignored local artifacts.

## 2026-07-25 — native Rust parity migration

- Replaced the compatibility observer, authentication contract, credentialed
  probe, configuration/resource parsers, and Debian package observer with
  native Rust implementations.
- Fixture compatibility hashes for discovery, package metadata, and Windows
  modules exactly matched the reviewed implementation contract.
- The Rust package observer reproduced the reviewed official Linux package
  JSON byte-for-byte.
- A public no-credential collection matched the production baseline with zero
  changes.
- Approved credentialed validation authenticated successfully; configuration
  and resource parsers passed; logout returned HTTP 200.
- Production evidence added the tilde resource-port range separator to the
  behavior specification and regression tests.
- Authentication buffers and form values are zeroized after use. No raw
  response, credential, cookie value, session identifier, CSRF value, RSA
  material, or resource value was committed.

## 2026-07-25 — TCP L3 static behavior map

- Source: the ignored, authorized official x86_64 Linux package recorded
  above.
- Added a native Rust executable mapper that reports only binary/text hashes,
  named behavior-marker counts, and text-relative references.
- Confirmed the TCP opening I/O lengths, 76-byte client-message layout,
  40-byte server-message validation, tunnel-role status rules, and bounded
  12-byte `IPCP` outer header.
- Added a Rust handshake model and frame codec using synthetic values only.
- Vendor preface bytes, raw disassembly, session-bound values, packet data,
  runtime addresses, and decompiler material were not copied into Git.
- At this stage dynamic confirmation was still required; the later entry below
  records the fixed preface/session-binding/control-reset evidence. Payload
  transforms, heartbeat inputs, accepted command/data tunnels, and UDP remain
  outstanding.

## 2026-07-25 — official-version adapter and live tunnel probe

- Added an x86_64 ELF/Mach-O/PE adapter that locates the two call-referenced,
  TLS-shaped fixed prefaces in an authorized local official executable.
- The committed adapter baseline contains only binary/text/preface hashes and
  lengths. No vendor bytes are committed.
- Static inspection confirmed that a 128-character hexadecimal `sslctx`
  decodes to 64 bytes; decoded bytes `32..48` bind the client tunnel message,
  while bytes `48..64` feed a still-unimplemented payload path.
- An approved credentialed run completed authentication and the exact
  82/122/43/76/40-byte TCP exchange, received valid `AABB` command framing, and
  logged out with HTTP 200. No business payload was sent.
- The gateway returned command type `3` (`SERVER_RESET`) for both the initial
  command role and one bounded, three-second-backoff fresh-command retry.
  Therefore command acceptance and send/receive data tunnels are not claimed.
- Credential, session binding, decoded context, cookies, assigned addresses,
  and raw frames were never serialized.

## 2026-07-25 — Windows L3 module and active protocol-family review

- Downloaded the gateway-advertised `/com/win/SangforL3Vpn.CAB` into ignored
  restricted storage and verified the manifest MD5 before extraction.
- CAB SHA-256:
  `b0a8247ed1a468c10b0be8efa4b1bb1fab9904d85ac2dcd9aec12abc67cfec5b`
- Extracted `SangforL3Vpn.dll` version `7,6,7,200` is PE32 x86; SHA-256:
  `3a93b43b7f404fb68edcff2aa952a46ee27bcc380af9cc8068bf2ccec38ed379`
- The x86 adapter identified one TLS-shaped 82-byte template and one 43-byte
  acknowledgement. The 82-byte template receives a 32-byte runtime patch at
  offset 44. Only hashes, lengths, architecture, and patch metadata were
  committed.
- Controlled probes tried the bounded legacy exchange with reviewed candidate
  runtime regions. Every completed legacy exchange returned command type `3`
  after one fresh-command retry. An isolated 64/36-byte module path was also
  rejected before a complete response and is not auto-selected.
- Binary-only comparison with the locally installed, known-working
  `zju-connect` executable identified a different active EasyConnect family
  with `tlsConn`, `SendConn`, and `RecvConn` paths. At this point no upstream
  source file had been read. The result reclassified the modern TLS dual
  connection and its tunnel-auth contract as the next implementation gate.
- All authorized runs authenticated and logged out successfully. No business
  packet was sent, and no credential, cookie, raw frame, TwfID, CryKey,
  `sslctx`, or assigned address was serialized.

## 2026-07-25 — modern protocol reference review

- Reviewed only the relevant EasyConnect transport files from
  `zju-connect` v1.1.1 (GPL-3.0) in an ephemeral Go module cache.
- The reviewed source is not copied into this repository, linked into the Rust
  binaries, downloaded at runtime, or used as an operational dependency.
- The review established the modern protocol contract: a session-derived
  48-byte token, a pinned address-control connection, and separate send and
  receive connections using command types `0`, `5`, and `6`.
- It also established that the special transport requires a deliberately old
  TLS 1.1/RC4 ClientHello shape. The reference disables certificate
  verification; this project does not adopt that behavior. Certificate-chain
  and hostname verification remain mandatory.
- Modern-path Rust code must be independently structured, regression-tested
  with synthetic values, and cross-validated against the authorized official
  module and live gateway. It must not be described as clean-room work.
- The repository is GPL-3.0-only, matching the reviewed reference's license.
  A release review must still retain attribution, corresponding-source, and
  redistribution obligations.

## 2026-07-25 — native modern empty-channel validation

- Added an isolated Rust TLS 1.1/RSA/RC4-SHA transport rather than linking or
  executing the reviewed Go implementation.
- The transport accepts only the reviewed cipher/version/compression shape,
  verifies the certificate through WebPKI, same-session verified HTTPS leaf
  binding, or an administrator-approved SHA-256 pin, and validates both
  Finished messages and every record MAC.
- The TLS 1.0/1.1 PRF passed an independently generated OpenSSL vector; bounded
  record encryption/decryption passed synthetic independent-state tests.
- An approved credentialed run established the verified 48-byte token,
  address-control connection, assigned-address response, send channel, and
  receive channel using the native Rust implementation.
- The three special connections were pinned to the peer used by the verified
  token connection, then immediately closed. Logout returned HTTP 200.
- No IP packet, SOCKS request, DNS request, heartbeat, or reconnect was sent.
  TWFID, token, assigned address, credentials, cookies, raw records, and
  cryptographic key material were not serialized.

## 2026-07-25 — native SOCKS data-path validation

- Added separately owned modules for authenticated session lifetime, EasyConnect
  channel ownership, IPv4 framing, userspace TCP/UDP, VPN DNS, SOCKS5, and the
  executable supervisor.
- An approved credentialed run started `ec-engine`, established all modern
  channels, bound a loopback SOCKS5 listener, and connected to the dedicated
  campus SSH test endpoint already recorded by the project.
- The test read only the server's SSH identification banner and immediately
  closed the connection. It did not authenticate to SSH, execute a command, or
  transfer a file.
- The native packet path and SOCKS listener succeeded; the engine then received
  a shutdown signal and logged out.
- The diagnostic output retained only booleans and the public SSH protocol
  banner prefix. Credentials, tunnel token, assigned address, packet contents,
  and traffic captures were not retained.

## 2026-07-30 — intermittent address-allocation review

- A local 1.0.4 reconnect reproduced a bounded modern address reply with
  non-success status `3`; no raw reply, token, session identifier, credential,
  cookie, or assigned address was retained.
- A narrowly scoped review of `zju-connect` v1.2.2's EasyConnect setup path
  found its explicit one-second minimum delay between token acquisition and
  the address request, documented there as necessary when requests are too
  fast. The project remains independent: no Go code, binary, runtime service,
  or dependency was copied or linked.
- The Rust session now owns the same timing contract through a monotonic
  deadline. Setup failures after login perform best-effort logout before the
  desktop's bounded retry, and diagnostics retain only the numeric status.

## 2026-07-25 — release-path validation

- Repeated the approved end-to-end check through the maintained macOS wrapper:
  start, loopback SOCKS readiness, one SSH identification-banner read from the
  dedicated campus test endpoint, signal shutdown, and logout all succeeded.
- The already-running official EasyConnect monitor, agent proxy, and agent
  remained running before and after the independent-client test.
- Built the Electron 43 arm64 directory artifact with electron-builder 26,
  applied and verified the repository's ad-hoc signing step, and inspected the
  packaged engine resources.
- The package contained only `ec-engine-darwin-arm64` and the reviewed
  `hkustgz.json`; no legacy or externally downloaded engine was included.
- `npm audit` reported zero known dependency vulnerabilities after the locked
  dependency refresh. Rust formatting, strict Clippy, all 47 unit tests, and
  the optimized `ec-engine` build passed with the pinned Rust 1.97.1 toolchain.
- No credential, cookie, token, assigned address, packet, or capture entered
  the repository or a process argument.

## 2026-07-25 — packaged desktop regression validation

- Rebuilt and launched the version 1.0.0 Apple Silicon application bundle with
  the packaged Rust engine and repository configuration.
- The desktop application authenticated with the approved test account, showed
  the connected state and assigned-address indicator, and exposed the configured
  loopback-only SOCKS5 listener.
- A single SOCKS5 connection to the dedicated campus SSH test endpoint returned
  the public OpenSSH identification banner. No SSH authentication, command, or
  file transfer was attempted.
- The connection switch stopped the owned engine and removed the listener.
  The already-running official EasyConnect monitor and agent proxy remained
  running.
- Constrained tray images to platform menu-bar dimensions and added a regression
  test so a full-size application icon cannot occupy the macOS menu bar again.
- Classified the native engine's authentication-failure diagnostic as terminal
  so invalid credentials do not trigger repeated gateway login attempts.
- Credentials were read only through the desktop system-protected store. They
  were not printed, passed as process arguments, retained on the clipboard, or
  added to the repository.

## Authorization note

The requester stated they are school staff and explicitly authorized official
client unpacking and use of the supplied test account. Formal institutional
authorization, vendor-contract review, named owners, retention limits, and
incident contacts still need to be entered in
`AUTHORIZATION_TEMPLATE.md` before broader dynamic analysis or distribution.
