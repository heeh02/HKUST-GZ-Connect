# ADR-0001: TUN mode

- Status: Deferred / Not Required for current 1.x or a future MFA minor release
- Date: 2026-08-23

## Context

当前Campus Browser、SOCKS5、HTTP CONNECT/HTTP/WS、PAC、Clash和SSH均已有production
wiring与offline/synthetic回归，设计上不修改系统DNS、默认路由或系统代理。当前exact-SHA
真实校园、Clash/SSH及系统状态before/after canary仍未完成，因此这里不声称现场覆盖率。

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

## Evidence

当前实现与开放门以[`../engineering/1x-release-gate.md`](../engineering/1x-release-gate.md)
记录的固定implementation snapshot为准：

- `desktop/lib/domain-route-policy.js`、`campus-browser.js`和PAC相关测试证明显式分流与
  Browser隔离的offline行为；
- `independent/src/engine/socks.rs`及HTTP forwarder测试证明loopback proxy协议边界；
- strict proxy、routing restart、20-tab和Main lifecycle Electron E2E证明本地组合路径；
- 仓库与发布manifest不存在TUN、route injection或privileged网络helper；
- password-only校园访问、Clash/SSH、sleep/wake、network switch以及系统DNS/route/proxy
  before/after仍是未勾选真实canary，不能由以上测试替代。

因此本ADR当前只证明“不引入TUN”是与已接入proxy-first架构一致的低风险决策，不证明
所有校园使用场景已经获得真实设备覆盖。
