# 1.x Convergence Plan

目标：以已发布的v1.2.3为1.x收束基线，继续关闭Architecture Frozen的真实环境与治理证据。
每批只解决一个主行为，保持password-only、SOCKS/HTTP、DNS、Campus Browser和无系统
网络污染不变量。PR #5已merge为`5d8323d`，main CI `32630023985`和tag build/release
`32630322732`均成功；发布完成不等于Architecture Frozen已经完成。

## Current implementation snapshot

| Batch | Local status | Remaining proof |
| --- | --- | --- |
| C1 Gateway/DNS determinism | Implemented and offline-tested | Authorized Gateway/HPC canary |
| C2 Single connection truth | FSM phase→UI projection；listener+Engine candidate双证据；fatal/stopping/exit同步撤销serving；错误/notice分域 | 真实sleep/network canary |
| C3 Full-attempt cancellation | Auth/Transport coordinator consumes control/EOF/signal/deadline；500 ms bounded drain；late result不能promotion | Remote cleanup在超时路径明确为unconfirmed，不宣称保证logout |
| C4 Serving shutdown | Outer service drain + three-socket shutdown + runner/bridge bounded join；exact-SHA三平台package/smoke通过 | Real Gateway canary and long soak |
| C5 Typed errors | Auth、credential、Data Plane retry已typed；legacy AUTH_FAILED不再归责密码；log I/O可见 | 其余旧Unclassified跨域继续下降 |
| C6 Lifecycle regression | Real Electron Main全链E2E；feature-gated真实Rust Engine 100轮post-Transport netstack/listener/stop/join/port-release soak | 真实Gateway lifecycle与30分钟persistent资源soak |
| C7 Package exactness | Exact native manifest、strict mac verification、macOS system-only dylib门、三平台launch smoke在exact SHA `6efca3c`通过；所有builder显式`--publish never` | Developer ID/notarization；后续版本继续执行exact-tag source reconciliation |
| C8 Initially-offline startup | commit `a6d4069`等待首个网络sample；离线只保留一个paused intent，online后按autoConnect exactly once恢复；ordinary policy拒绝后仍可手动连接 | 本地与PR #6 CI/Electron通过；真机cold-offline canary待补 |
| C9 UDP association ownership | commit `a6d4069`把upload/download relay纳入父future结构化取消作用域 | 本地与PR #6 Rust CI通过；真实UDP socket/port回收增强测试待补 |
| C10 Browser connection wait ownership | commit `a6d4069`使用intent-bound事件驱动registry替代100 ms轮询，并对retry/paused/quit建立明确收束 | 本地与PR #6并发open/coalescing、quit/timeout和Main lifecycle CI通过 |
| C11 Quit connection gate | commit `a6d4069`在connect/reconnect入口及每个异步stop/wait边界检查quit owner，晚到请求只能fail-closed | 本地与PR #6 source contract、Main integration/lifecycle及三并发open回归通过 |

本表只描述本地实现，不替代下方P0远端和真实环境门。

## P0 — Architecture Frozen governance and evidence blockers

这些不一定是runtime bug。v1.2.3维护者已明确接受其中的外部证据边界并完成发布；但在
它们关闭前，不能宣称`1.x Architecture Frozen`：

1. [完成] 用户授权后push review branch并建立PR #5；
2. [完成] exact review SHA的ordinary CI、macOS Electron、Windows sidecar DACL、Rust全部通过；
3. [完成] 同一SHA的macOS arm64/x64、Windows x64、Linux x64 clean package通过；
4. [完成] 三平台unpacked launch smoke、package exact manifest与macOS dylib closure通过；
5. [完成] 最终review、merge、main exact-commit CI、tag source reconciliation与唯一publisher通过；
6. [未完成] `main` required checks和no-force-push branch rule生效；
7. [未完成] 授权环境完成password-only、HPC DNS、Clash/SSH、sleep/wake/network switch canary；
8. [完成] capability ledger区分implementation与evidence；
9. [永久规则] 任何后续release都必须从其exact tag clean build，不复用旧`desktop/release`。

## P1 — Architecture Frozen blockers

### C1. Gateway path determinism

- Gateway reqwest默认 `.no_proxy()`；
- poisoned `HTTPS_PROXY/ALL_PROXY` contract测试；
- 文档明确 SystemDefault是系统 route，不是 environment HTTP proxy；
- DNS parser补 OPCODE、answer owner和 bounded CNAME chain。

完成定义：Gateway control/data不会因环境代理隐式分裂；DNS只接受与查询语义关联的 A。

### C2. Single connection truth

- 扩展 Desktop相位到 starting/authenticating/preparing/connected/retry/pause/stopping/idle；
- Engine事件、listener barrier、stop、retry、network recovery全部进入 coordinator/reducer；
- UI/tray/telemetry/browser presentation从 snapshot纯投影；
- 删除独立 `state.connected/state.connecting` 写入；
- error分域，不让 Browser/settings notice覆盖 Engine terminal outcome。

完成定义：任意时刻一个 snapshot可解释按钮、托盘、Browser gate、retry和child ownership。

### C3. Full-attempt cancellation

- ConnectionAttemptCoordinator覆盖 Auth、Transport、listener bind；
- control、EOF、signal、deadline、generation变化对每阶段有效；
- blocking network阶段在有界 worker中运行并接受 cooperative cancellation；
- late session/transport result必须 cleanup，不能 promotion；
- user cancel保留 cleanup-unconfirmed。

完成定义：对 config GET、token、address/send/receive setup和retry sleep逐点 fault，均在一个
terminal序列内结束，旧 generation不能 listener-ready。无法在500 ms内合作退出的同步调用
必须在Desktop control grace内以cleanup-unconfirmed结束进程，不得伪报干净停止。

### C4. Deterministic serving shutdown

固定顺序：

```text
close Browser/request gate
→ close listener
→ cancel/drain client tasks
→ close DNS/netstack/data-plane
→ bounded join task/thread
→ Gateway logout
→ stopped
```

需要 `VirtualNetstack::shutdown`/Drop contract、SOCKS serving owner和时序测试；不能只依赖进程
最终退出。

### C5. Typed cross-boundary errors

- DataPlane/special TLS错误 kind；
- retry policy禁止字符串搜索；
- worker panic/internal failure不再映射 wrong password；
- credential load区分 missing/decrypted/unavailable/corrupt；
- connection/browser/settings/recovery outcome分域；
- `Unclassified`跨域数量建立只降不升 ratchet。

### C6. Whole-process and post-Transport lifecycle regression

建立不会进入发布包的分层synthetic证据：

- Desktop层覆盖Main→synthetic Engine hello→authenticating→preparing→listener→connected，
  以及unexpected close、terminal error、retry、stale generation、renderer crash和窗口恢复；
- Rust层用feature-gated真实`ec-engine`覆盖non-routing post-Transport netstack、真实loopback
  listener/SOCKS greeting、explicit stop、bounded join和端口释放；
- TCP/HTTP/WS/UDP/DNS的协议与停止行为由各自module/integration tests承担，不能把它们全部
  归因于该Rust subprocess fixture；
- 每个被覆盖的failure只允许一组stopping/fatal/stopped。

### C7. Package exactness

- `engine/` exact allowlist；
- 拒绝额外 native文件/错误架构；
- mac签名存在时 strict verify；
- 三平台 unpacked launch smoke；
- stale package不得作为证据。

## P2 — Post-freeze incremental debt reduction

- `main.js`按 connection、settings recovery、proxy access、browser policy、update service渐进抽离；
- `ec-engine.rs`沿 attempt coordinator/serving scope拆分；
- `socks.rs`沿 listener/session/UDP owner拆分；
- architecture gate增加 layer allowlist，不只看行数；
- Windows DACL扩展到含 username/日志/策略的隐私文件；
- 将pre-spawn设置/凭据/engine-missing失败与最终`close`归一为exactly-once、无路径无secret的
  correlated terminal diagnostic；当前结构化Engine事件已有`intent:generation`，不得过度声明
  为所有Desktop早期失败均已覆盖；
- versioned RoutingPolicyIR + JS/PAC differential corpus；
- test-only synthetic HTTPS Gateway作为未来真实MFA provider activation前置；不属于v1.2.3。

已在v1.2.3收束树完成、不得重复列为新功能：log I/O恢复通知、真实Rust Engine的100轮
non-routing post-Transport生命周期soak，以及发布包fixture marker双重门禁。

## P3 — Evidence-triggered work

-真实 HKUST MFA provider；
- ControlledDirectExit；
- explicit underlay binding和online interface generation；
- multi-line/WebVPN/aTrust/Android/forwarding；
- TUN保持 Deferred，直到 ADR重新批准。

## Recommended commit sequence

```text
docs: define project architecture and release evidence
fix(network): disable implicit gateway environment proxies
fix(dns): bind answers to query owner and cname chain
refactor(desktop): make connection snapshot authoritative
refactor(engine): coordinate transport cancellation
fix(engine): drain serving resources before logout
refactor(errors): remove string-driven retry and split outcomes
test(lifecycle): add whole-process synthetic success and fault gates
build: enforce exact native manifests and launch smoke
docs: close release gate with exact evidence
```

每个提交应独立通过相关 tests；不得用历史重写破坏现有 checkpoint，也不得把 `sshr.sh` 或
构建垃圾纳入提交。

## Rollback

- 每批以 file/module级 revert恢复前一行为；
- 不修改 Gateway wire bytes的批次不得触碰 `special_tls11` fixture；
- 新 coordinator在完全接管前保留旧测试作为 differential oracle；
- 真实 provider/underlay/DirectExit均需独立 feature gate和fail-closed fallback；
- rollback不能恢复隐式环境 proxy、public DNS fallback或无认证 non-loopback listener。
