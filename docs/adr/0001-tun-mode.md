# ADR-0001: TUN mode

- Status: Deferred / Not Required for current 1.x or a future MFA minor release
- Date: 2026-08-23

## Context

当前 Campus Browser、SOCKS5、HTTP CONNECT/HTTP/WS、PAC、Clash 和 SSH 已覆盖主要校园
Web 与显式代理场景，同时不修改系统 DNS、默认路由或系统代理。

TUN 可以覆盖不支持 proxy 的应用、任意 TCP/UDP 和透明访问，但会引入管理员权限、
route/DNS ownership、IPv6、MTU、系统升级、crash rollback、与 Clash/其他 VPN 冲突及显著
的跨平台维护面。

## Decision

当前1.x和未来单独的MFA minor release都不实现、不默认启用TUN。2.0只保留一个可选
Ingress位置，不将TUN当作
Routing Engine 或 Exit。

只有同时满足以下条件才重新打开 ADR：

1. 有量化的重要应用无法通过 Campus Browser/SOCKS/PAC/SSH；
2. 受影响场景不能通过受控 TCP/UDP forwarding 解决；
3. 三平台均有签名、可撤销、最小权限组件方案；
4. Gateway underlay bypass/loop guard 已真机验证；
5. DNS ownership、IPv6、MTU、sleep/wake 和升级回滚有独立 threat model；
6. 100 次 crash/kill/reboot 后系统 DNS/route/proxy 残留为 0；
7. TUN 关闭后 proxy-first 代码路径与行为不变；
8. 它能作为独立版本和独立回滚单元，不与 MFA/aTrust 捆绑。

## Alternatives

| 方案 | 当前判断 |
| --- | --- |
| Campus Browser | 普通用户校园 Web 首选 |
| SOCKS/HTTP proxy | 高级应用与 Clash/SSH 首选 |
| PAC | 外部浏览器域名分流 |
| Per-app proxy | 平台证据出现后评估 |
| Scoped forwarding | 有具体非 proxy 应用时优先评估 |
| Route injection | 与 TUN 类似需要权限和回滚，当前不采用 |
| TUN | Deferred |

## Consequences

优点：维持无系统污染、低权限、与现有代理共存和较小安全面。

代价：不支持 proxy 且无法配置 forwarding 的应用目前不能透明访问校园资源。该限制应
如实记录，不通过扩大权限掩盖。

## Security and rollback

当前没有 privileged TUN component，因此卸载/强杀不会留下由本项目创建的系统 route
或 DNS。未来重新决策时必须提供系统状态 before/after verifier 和自动 rollback。
