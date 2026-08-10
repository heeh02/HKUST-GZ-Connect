# Desktop security model / 桌面端安全模型

This document records the security boundary of the Electron desktop client.
It is a maintenance contract, not a claim that arbitrary vendor or gateway
changes can be supported without review.

本文记录 Electron 桌面端必须长期维持的安全边界，供代码审核和网关升级时使用。
它不是“未来所有 EasyConnect 版本都无需维护”的承诺。

## Hard invariants / 不可破坏的约束

- The engine listener is always an explicit loopback endpoint. The app never
  changes system DNS, the default route, the global proxy, or a system network
  extension.
- 新安装默认使用仅监听回环地址的 SOCKS5 `NO_AUTH` 兼容模式，保证 SSH、Clash
  与外部 PAC 无需应用私有凭据即可使用。同机其他进程或登录用户可能借用已认证
  会话，这是默认易用性与共享主机隔离之间的明确取舍。
- Strict authentication is an explicit shared-machine hardening option. A
  stable random local-proxy credential is encrypted with the operating-system
  secure-storage service; each engine generation receives only a short-lived
  in-memory copy. Campus Browser authenticates automatically, Clash receives an
  authenticated `udp: false` node through an explicit clipboard action, and
  the bundled SSH helper reads an owner-only sidecar that is removed whenever
  the listener stops. Credentials never enter argv or logs.
- Campus Browser is one persistent, sandboxed, context-isolated Session. It
  denies device permissions, Node integration, arbitrary IPC, and unsupported
  navigation schemes.
- Before an engine releases its fixed local port, the browser closes a
  synchronous request gate, installs a fail-closed PAC, and drains connections.
  Only `listener_ready` for the current generation can reopen that gate.
- Chromium WebRTC is started with `disable_non_proxied_udp`. Explicit
  localhost, loopback, link-local, WebSocket, and legacy localhost aliases are
  denied again at `webRequest` because PAC mode cannot override Chromium's
  implicit loopback bypass.
- Certificate exceptions are exact HTTPS origin plus DER SHA-256 fingerprint,
  owner-only and local. Only an owned main-frame navigation can prompt; all
  subresource certificate errors fail closed. Prompts are globally
  single-flight and lifecycle cancellation rejects pending callbacks.
- Website credentials are exact HTTPS-origin scoped, saved only after a later
  successful navigation and explicit confirmation, and encrypted by the OS.
  Linux `basic_text` fallback is rejected.

## Account and policy persistence / 账号与策略持久化

- The VPN username, encrypted password, settings, and settings backup use one
  owner-only rollback journal for every credential change and logout.
- Recovery runs before settings are loaded, credentials are inspected, or a
  journal permission could be changed. A missing journal is accepted only when
  absence is proven with `ENOENT`; transient I/O or permission errors block all
  connections and settings writes.
- A username change always requires a non-empty password in the same
  transaction. The non-decrypting password-presence probe is never treated as
  proof that no old credential exists.
- If a partial mutation loses its rollback journal, the encrypted password is
  durably removed; if removal cannot be proven, manual and automatic
  connections remain blocked.
- Domain rules, shortcuts, settings, external PAC, and the live browser policy
  are serialized. Policy updates suspend the browser first and roll every
  source/derived representation back on failure. Incomplete rollback leaves the
  browser blocked.
- Private JSON and credential files use bounded reads, regular-file/no-symlink
  checks, mode `0600` on POSIX, file `fsync`, same-directory rename, and
  directory `fsync`. Windows keeps the file-fsync/rename guarantee where
  directory handles are unavailable.

## Data that must never be emitted / 禁止输出的数据

Passwords, proxy credentials, cookies, tokens, raw authentication responses,
full resource URLs with queries, assigned addresses, and target addresses must
not enter engine stdout events, application logs, diagnostics, Git, CI
artifacts, or release notes. Engine stdout is bounded NDJSON API v1; human
diagnostics go to redacted stderr/log files with bounded rotation.

The explicit **Copy Clash Node** action necessarily places the local proxy
credential on the operating-system clipboard, and Clash stores the pasted
credential in its own configuration. The application neither reads nor edits
that configuration. This user-authorized integration boundary is distinct from
logs, telemetry, renderer IPC responses, and process arguments, where the
credential remains prohibited.

## Known limits / 已知边界

- A PAC and URL-level request guard can deny explicit local-address literals,
  but cannot prove the resolved IP of every Direct hostname. Chromium's Private
  Network Access protections reduce DNS-rebinding risk; an absolute guarantee
  would require routing all browser traffic through a local policy proxy that
  resolves and validates destinations itself.
- Strict mode deliberately rejects SOCKS UDP ASSOCIATE. A TCP-authenticated
  control connection cannot securely establish cross-user ownership of a
  wildcard loopback UDP endpoint on every supported OS. Compatibility mode
  retains UDP for advanced clients.
- Any local process can consume pre-authentication TCP slots for the bounded
  handshake timeout. Cross-platform per-user ownership is unavailable for
  ordinary loopback TCP, so strict authentication protects authorization, not
  all same-host denial of service.
- The current production profile allows explicit system-DNS fallback inside
  the engine because the observed gateway profile may omit VPN DNS. It must not
  be disabled until an approved campus canary proves gateway DNS is supplied;
  it never changes the operating-system DNS configuration.
- Password, CAPTCHA, SMS/token/TOTP, certificate, HID, SSO, resource catalogue,
  WebVPN, and L3 are separate provider capabilities. An unimplemented or
  unknown method must surface as unsupported and fail closed, never be
  reclassified as a wrong password.

## Required review gates / 必须通过的门禁

Every release must pass desktop unit tests, real Electron main/toolbar/layout
tests, browser lifecycle soak, dependency audit, Rust format/Clippy/tests,
offline performance matrices, package-content verification, secret scanning,
and unsigned macOS/Windows launch checks. Live gateway TCP, UDP, DNS, sleep,
network-change, forced-logout, and new authentication canaries require explicit
school authorization and sanitized evidence.
