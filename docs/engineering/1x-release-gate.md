# 1.x Architecture Frozen and Release Gate

状态：No-Go。勾选项只表示当前本地证据；未勾选项不得由“应该能工作”替代。

本地实现证据基线：`de91a42dd67eaee019a11edf00a9ace9ccee1066`；文档提交不改变该实现树。
本轮产品版本仍为v1.2.3：新增内容属于补丁级稳定性、诊断、回归和交付门禁，不是新的
production Gateway能力。

## 1. Source and governance

- [x] 当前本地审计 HEAD和分支已记录。
- [x] 实现快照`de91a42`的exact tree secret gate通过。
- [ ] Review branch已push且远端 SHA与候选发布源码一致。
- [ ] PR包含全部改动并完成review。
- [ ] `main` required checks、latest commit、review和no-force-push已启用。
- [ ] 合并commit、tag和release source SHA一致。

## 2. Architecture and state

- [x] Authenticated Session与Transport边界有module tests。
- [x] Desktop CommonJS graph 0 cycles。
- [x] Desktop连接 presentation只有一个权威状态源。
- [x] Engine显式 phase/transition table覆盖Auth→Transport→Serving→Stopping。
- [x] Browser/settings/recovery/log notice不能覆盖Engine terminal outcome。
- [x] 非法/stale/非`preparing-tunnel` transition不能持有或提升资源。
- [x] `main.js`保持1596行/35直接依赖ratchet，且production layer gate无反向依赖。

## 3. Lifecycle and resources

- [x] Engine child ownership持续到`close`。
- [x] stop有control/SIGTERM/SIGKILL有界流程。
- [x] password auth可响应shutdown、EOF和deadline。
- [x] Auth/Transport阶段持续消费shutdown、EOF、signal和deadline，late result执行cleanup。
- [x] 单次在途blocking操作在500 ms drain内协作结束；否则Engine在6秒Desktop control envelope内以cleanup-unconfirmed非零退出，late result不能promotion。
- [x] user cancel保留cleanup-unconfirmed且不会自动立即重连。
- [x] listener/outer serving scope在logout前关闭并drain。
- [x] netstack/data-plane socket、runner和bridge thread有bounded shutdown/join。
- [x] 100次deterministic supervisor start/invalidate/stop/close无lifecycle residue。
- [ ] 100次真实Engine connect/stop/reconnect无PID、port、thread、timer增长。
- [ ] sleep/wake、offline/online、Wi-Fi切换通过真实设备canary。

## 4. Errors and diagnostics

- [x] Explicit reject、indeterminate、protocol invalid和cleanup secondary可区分。
- [x] 只有明确拒绝显示凭据未通过。
- [x] Worker/internal failure和legacy `AUTH_FAILED`不使用wrong-password文案。
- [x] Data Plane retry只读稳定kind，不搜索英文字符串。
- [x] Credential load区分missing/unavailable/corrupt/decrypt denied。
- [x] Connection、Browser、settings、recovery和log outcome分域。
- [x] terminal failure有stable code；本地生命周期诊断以`intent:generation`关联且不记录认证秘密。
- [x] Log writer后台及显式reset/flush/close失败只显示一次无路径、无secret的诊断通知。

## 5. Authentication and secret lifecycle

- [x] Control v2 secret-free。
- [x] v3 response有界、zeroizing且不进入Renderer state/log。
- [x] stale/duplicate/valid cancel exactly-once回归。
- [x] challenge deadline/steps/submits/resends/request budgets有界。
- [x] 模糊单secret字段不进入Campus Browser vault。

以下三项是未来真实Gateway MFA provider的activation gate，不适用于当前password-only
v1.2.3的GO/NO-GO，也不能因为已有generic fixture而提前勾选：

- [ ] Password→Challenge共用一个AuthAttemptBudget。
- [ ] Provider只能通过BudgetedGatewayHttp执行continuation请求。
- [ ] v3 expiry/limit/cancel保留cleanup secondary。
- [x] Production真实MFA capability仍关闭，unknown method fail-closed。

## 6. Network, DNS and proxy

- [x] Local listener只绑定loopback。
- [x] 新安装strict proxy；旧用户降级需显式选择。
- [x] SOCKS5/HTTP CONNECT/HTTP/WS核心回归通过。
- [x] Campus DNS只走VirtualNetstack；production system fallback关闭。
- [x] 合法TC响应只向同一校园resolver走TCP。
- [x] Gateway HTTP显式不继承environment proxy并有架构回归。
- [x] DNS OPCODE、owner和bounded CNAME chain严格验证。
- [x] PAC/JS policy deterministic differential corpus通过。
- [ ] 真实HPC normal query canary通过。
- [ ] 受控DNS TC→TCP canary通过（环境可提供时）。
- [ ] 系统DNS、route、global proxy before/after diff为0。

## 7. Desktop and Browser

- [x] Control/Campus Browser sandbox、contextIsolation、Node off。
- [x] Exact IPC sender/file/schema gate。
- [x] Same-window、SPA和popup MFA Electron E2E。
- [x] Browser request gate在Engine exit/策略切换时fail-closed。
- [x] 20-tab synthetic soak和routing restart通过。
- [x] Main+synthetic Engine完整connect/listener/stop/retry E2E。
- [x] Control renderer crash后窗口可重建且健康Engine不被误停。
- [ ] Campus site、Outlook/Canvas direct→SAML return真实canary。
- [x] 1.x Chromium `DIRECT` resolved-address限制已由ADR-0002正式接受；2.0 ControlledDirectExit负责消除。

## 8. Tests and static gates

- [x] Rust fmt通过。
- [x] Rust Clippy `-D warnings`通过。
- [x] Rust tests：当前收束树全量通过；精确数量记录在最终验证快照。
- [x] Desktop tests：524 total / 523 passed / 0 failed / 1 Windows-only skipped。
- [x] npm audit high：0 vulnerabilities。
- [x] Architecture/cycle gate通过。
- [ ] 最终候选HEAD（含文档提交）的exact tree secret gate通过。
- [x] Main/MFA/popup/strict proxy/auth pipe E2E通过。
- [x] Desktop Main→synthetic Engine的retry/stale/listener/renderer-crash/stop/port-release场景通过。
- [x] feature-gated真实`ec-engine`子进程通过post-Transport netstack/listener/stop/join/port-release回归；不证明真实Gateway认证、Modern L3或校园转发。
- [ ] Resource leak soak通过。
- [ ] Windows runner真实DACL test通过。
- [ ] 所有required CI jobs在候选SHA绿色。

## 9. Package and platform

- [x] package verifier拒绝test/e2e/fake gateway/test PKI/private key pattern。
- [x] Native `engine/`目录使用exact platform manifest。
- [x] 所有官方production/package构建显式关闭test feature；`afterPack`在签名前拒绝fixture marker，独立verifier在打包后再次拒绝。
- [ ] macOS arm64 clean package verifier和launch smoke。
- [ ] macOS x64 clean package verifier和launch smoke。
- [ ] Windows x64 NSIS/unpacked verifier和launch smoke。
- [ ] Linux x64 AppImage/unpacked verifier和launch smoke。
- [ ] macOS存在签名时`codesign --verify --deep --strict`通过。
- [ ] 所有产物来自同一clean checkout/exact SHA。
- [ ] 旧`desktop/release`未被复用或上传。

## 10. Documentation and capability truth

- [x] 根项目架构宪法存在。
- [x] 1.x audit、convergence plan和release gate存在。
- [x] Future Gateway MFA architecture明确generic与production差异；它不改变v1.2.3能力声明。
- [x] 2.0 vision、capability matrix、TUN ADR和ControlledDirectExit风险ADR存在。
- [x] `independent/ARCHITECTURE.md`与DNS TCP和shutdown当前行为一致。
- [x] ROADMAP/compatibility matrix统一Implementation+Evidence状态。
- [x] 用户README只说明真实可用功能，并明确Gateway MFA和真实环境证据边界。
- [ ] Release notes准确披露签名、公证、平台和未验证边界。

## 11. Release decision

只有所有适用P0/P1和平台/真实环境硬门完成，才可写：

```text
1.x Architecture Frozen: YES
Release: GO
```

当前结论：

```text
1.x Architecture Frozen: NO
Release: NO-GO
```
