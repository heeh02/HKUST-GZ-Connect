# Compatibility matrix

This matrix prevents detection work from being mistaken for a finished
independent VPN engine.

| Capability | Production observation | Offline fixture | Independent engine | Official-client parity |
|---|---:|---:|---:|---:|
| Public discovery | yes | yes | observer only | not applicable |
| Package/version metadata | yes | yes | observer only | not applicable |
| Windows module policy | yes | yes | observer only | not applicable |
| Installer content identity | yes | hash check | observer only | not applicable |
| Username/password auth | live success | yes | probe only | one approved run |
| CAPTCHA | observed disabled | auth-state fixture | state classified; interaction pending | pending enabled profile |
| SMS/TOTP/certificate/HID/SSO | official package + capability discovery | auth-state fixtures | states classified; providers pending | pending enabled profiles |
| Password expiry/change | official package capability | pending | control contract planned | pending enabled profile |
| Session configuration parsing | live accepted | yes | Rust parser core | live parser pass |
| Resource-list parsing | legacy field/port parser accepted the reviewed profile; v1 not canaried | bounded group/resource/query/auth fixtures | offline Rust provider; opaque handles and redacted v1 view | v1 live parser canary pending |
| Resource authorization decisions | field shape observed; value semantics unverified | opaque-value negative fixture | explicitly unavailable; never inferred from field presence | pending approved policy profile |
| Authenticated resource catalogue/UI | official resource page | offline parser fixture only | retrieval provider/UI pending | pending |
| Legacy tunnel wire exchange | live 82/122/43/76/40 exchange | yes | Rust state machine | server magic/reset confirmed |
| Legacy command/data acceptance | server reset observed | command-open fixture | bounded probe only | rejected on this profile |
| Modern TLS send/receive tunnels | live empty channels accepted | synthetic codec/crypto vectors | isolated Rust transport | empty send/receive parity passed |
| Modern tunnel authentication | live 48/64-byte contract accepted | yes | memory-only Rust token/control codec | address control accepted |
| Modern IPv4 framing | live Rust data path | fragmented/coalesced fixtures | bounded Rust codec | live TCP packets passed |
| Legacy IPCP framing | static official map | yes | bounded diagnostic codec | not used by active profile |
| TCP via SOCKS5 | approved campus HTTPS 200 | parser and netstack tests | modular Rust runtime | repeated browser/curl pass |
| Strict HTTP/WS proxy | Chromium strict PAC contract identified | bounded GET/POST/chunked/407/header-strip/WS and real-loopback fixtures | Basic-authenticated CONNECT plus ordinary HTTP/WS forwarder; default and optional modes reject HTTP | live ordinary HTTP/WS canary pending |
| UDP via SOCKS5 | current target returned no response | header/DNS/fragment/lifecycle fixtures | UDP ASSOCIATE relay after `NO_AUTH`; optional RFC 1929 and strict mode reject it to prevent cross-user relay theft; close remains healthy | reachable live UDP service pending |
| Isolated Campus Browser | official resource/browser flow | URL/proxy policy fixtures | Electron session; all browser traffic uses tunnel | independent browser canary pending |
| Domain-selective PAC | campus page loaded through PAC | exact/suffix/no-DNS fixtures | advanced integration endpoint | isolated Chrome pass |
| VPN-side DNS | no DNS server in current profile | DNS codec fixtures | used when supplied | not applicable to current profile |
| Explicit system DNS fallback | enabled by reviewed current profile | domain validation fixtures | modular Rust resolver | live domain CONNECT passed |
| Logout | live HTTP 200 | state test | Rust probe | live pass |
| Reset/reconnect | live server reset | state test | bounded reset retry | reset path confirmed |
| Timeout/data-plane recovery | process-level restart contract | bounded timeout tests pending | unhealthy engine exits | sleep/resume canary pending |
| Passive logout / forced upgrade | official package capability | pending | text error only; structured event pending | pending |

Use `yes` only for evidence that can be reproduced. A production feature is
supported only when the independent-engine and official-client-parity columns
both pass for the gateway profile in scope.
