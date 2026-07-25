# hkustgzconnect 1.0.0

Version 1.0.0 is the first release backed by the repository's modular Rust
EasyConnect-compatible engine.

## Highlights

- Native Rust authentication, session, control-channel, and packet data path.
- Userspace TCP/UDP stack, VPN-side DNS, and loopback-only SOCKS5 frontend.
- No downloaded or runtime dependency on `zju-connect`.
- macOS Apple Silicon and Intel packages, plus a Windows x64 installer.
- System-protected desktop credential storage: macOS Keychain or Windows
  DPAPI.
- Tray controls, automatic reconnect, startup connection, PAC browser helper,
  and SSH proxy configuration helper.
- Daily public EasyConnect compatibility monitoring and fail-closed protocol
  checks.

## Validation

- 47 Rust tests, strict Clippy, and formatting checks.
- Desktop module tests, syntax checks, and zero known `npm audit`
  vulnerabilities.
- Approved macOS end-to-end validation through the packaged Rust engine:
  login, address/send/receive channels, SOCKS5, campus SSH identification
  banner, signal shutdown, and logout.

## Installation notes

The macOS packages are ad-hoc signed unless the release workflow has access to
the institution's Developer ID credentials. For an ad-hoc build, use
right-click **Open** the first time. Do not bypass TLS or gateway certificate
warnings.

Desktop users upgrading from 0.x sign in once because 1.0.0 intentionally does
not migrate the previous weak local credential format.

SHA-256 checksum files are published alongside the installers.
