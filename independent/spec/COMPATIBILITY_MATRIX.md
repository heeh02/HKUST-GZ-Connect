# Compatibility matrix

This matrix prevents detection work from being mistaken for a finished
independent VPN engine.

## Current implementation/evidence status

This file uses the repository-wide two-axis model:

- implementation `I0` absent, `I1` type/interface, `I2` offline/synthetic,
  `I3` production-wired, `I4` multiple production implementations;
- evidence `E0` absent, `E1` source/contract, `E2` unit/synthetic, `E3`
  packaged cross-platform, `E4` authorized HKUST canary, `E5` same-profile
  official-client parity.

Historical live observations below do not automatically raise a newer source
tree. The current Engine tree is byte-identical to the published
`v2.0.0-beta.1` tag: the tag build tested and packaged it on macOS, Windows and
Linux, while the installed macOS Beta assigned a Campus IP, selected Gateway
DNS and reached the school homepage through its loopback SOCKS listener. The
HPC hostname also resolved through the tunnel and reached its HTTPS service.
These are HKUST canaries, not official-client parity and not evidence for
another school or an unexercised protocol branch.

| Capability | Implementation | Current-tree evidence | Support truth |
|---|---:|---:|---|
| Password Gateway auth | `I3` | `E4` | Published-Beta Engine authenticated and assigned a Campus IP; current official-client parity remains separate |
| Modern L3 IPv4 | `I3` | `E4` | Published-Beta Engine carried live campus HTTPS traffic; broader reconnect/handover canaries remain separate |
| Campus DNS UDP/TCP | `I3` | `E4` / `E2` | Gateway DNS and an internal-only HPC hostname passed live; matching-TC TCP fallback remains synthetic only |
| SOCKS5 and strict HTTP/WS | `I3` | `E4` / `E3` | Live SOCKS and Mihomo-to-SOCKS campus HTTPS passed; strict ordinary HTTP/WS and SSH canaries remain pending |
| Campus Browser/domain routing | `I3` | `E3` | Packaged synthetic Electron; real partner/campus SSO canary pending |
| Resource catalogue | `I2` | `E2` | Offline only; not advertised as retrieved/authorized |
| Generic challenge framework | `I2` | `E2` | Architecture/test fixture only; no real Gateway MFA provider |
| Real Gateway MFA methods | `I0` | `E0` | Unsupported until one method passes its activation gate |
| WebVPN | `I1` | `E1` | Typed slot only; no backend |
| TUN | `I0` | `E1` decision | Intentionally deferred by ADR-0001 |

## Detailed evidence ledger

| Capability | Production observation | Offline fixture | Independent engine | Official-client parity |
|---|---:|---:|---:|---:|
| Public discovery | yes | yes | observer only | not applicable |
| Package/version metadata | yes | yes | observer only | not applicable |
| Windows module policy | yes | yes | observer only | not applicable |
| Installer content identity | yes | hash check | observer only | not applicable |
| Username/password auth | published-Beta live success | yes | production provider and packaged Engine | one earlier approved run; current parity not repeated |
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
| VPN-side DNS | advertised source has varied across observed sessions; reviewed profile supplies two internal resolvers when absent | DNS codec, exact txid/question, TC, partial TCP, oversize, timeout, source merge, policy, race and cache fixtures | authenticated gateway source preferred; reviewed profile fallback through userspace UDP; matching TC retries the same resolver over userspace TCP | record selected source plus HPC hostname and truncated-answer canary per release |
| Explicit system DNS fallback | disabled by reviewed current profile | production profile contract test | implementation retained for other profiles but not selected | not applicable to HKUST(GZ) production |
| Logout | live HTTP 200 | state test | Rust probe | live pass |
| Reset/reconnect | live server reset | state test | bounded reset retry | reset path confirmed |
| Timeout/data-plane recovery | process-level restart contract | bounded timeout tests pending | unhealthy engine exits | sleep/resume canary pending |
| Passive logout / forced upgrade | official package capability | pending | text error only; structured event pending | pending |

Use `yes` only for evidence that can be reproduced. A production feature is
supported only when the independent-engine and official-client-parity columns
both pass for the gateway profile in scope.
