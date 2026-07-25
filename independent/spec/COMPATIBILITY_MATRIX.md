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
| CAPTCHA | observed disabled | pending | not started | pending |
| SMS/TOTP/certificate/HID/SSO | capability discovery only | pending | not started | pending |
| Session configuration parsing | live accepted | yes | Rust parser core | live parser pass |
| Resource-list parsing | live accepted | yes | Rust parser core | live parser pass |
| Legacy tunnel wire exchange | live 82/122/43/76/40 exchange | yes | Rust state machine | server magic/reset confirmed |
| Legacy command/data acceptance | server reset observed | command-open fixture | bounded probe only | rejected on this profile |
| Modern TLS send/receive tunnels | live empty channels accepted | synthetic codec/crypto vectors | isolated Rust transport | empty send/receive parity passed |
| Modern tunnel authentication | live 48/64-byte contract accepted | yes | memory-only Rust token/control codec | address control accepted |
| Modern IPv4 framing | live Rust data path | fragmented/coalesced fixtures | bounded Rust codec | live TCP packets passed |
| Legacy IPCP framing | static official map | yes | bounded diagnostic codec | not used by active profile |
| TCP via SOCKS5 | approved SSH banner received | parser and netstack tests | modular Rust runtime | one endpoint passed |
| VPN-side DNS | gateway servers parsed | DNS codec fixtures | modular Rust resolver | sustained canary pending |
| Logout | live HTTP 200 | state test | Rust probe | live pass |
| Reset/reconnect | live server reset | state test | bounded reset retry | reset path confirmed |
| Timeout/data-plane recovery | process-level restart contract | bounded timeout tests pending | unhealthy engine exits | sleep/resume canary pending |

Use `yes` only for evidence that can be reproduced. A production feature is
supported only when the independent-engine and official-client-parity columns
both pass for the gateway profile in scope.
