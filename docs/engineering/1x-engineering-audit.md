# 1.x Engineering Audit

日期：2026-08-23

收束实现快照：`b48a6e7eca9fbee4655e9019297f798d51d5baba`。
第2节保留的是审计开始时的历史基线；第7节记录整改后的当前结论，不能用旧计数覆盖新证据。

审计基线：`0470ca306f1658ec2444ed63ebe703b3b0ec7e59`
（`codex/v1.2.3-hardening`）。审计开始时 `origin/main` 为
`0ae0d33de0c3056f3f95f4a70154b74f7518f715`，本地分支尚无远端 PR。

“1.0”在本文件表示 1.x Architecture Frozen 工程基线，不表示将产品版本从 1.2.3
降级。结论来自当前代码、依赖源码和本轮实际测试；历史报告只用于定位线索。

## 1. Executive conclusion

当前代码已经具备较强的安全与回归基础：认证/Transport 边界、typed auth outcomes、
stale cancel、Engine-owned challenge budgets、浏览器 OTP 防误存、严格本地 proxy、三天
日志期限和大量 fault tests 均真实存在。

本地代码级P0/P1已经收束：Gateway HTTP不继承环境代理，Auth/Transport可取消，serving
资源按有界顺序退出，Desktop只有一个连接事实源，Main全链E2E与真实Rust Engine的
post-Transport子进程回归均已建立。后者是feature-gated、无外部路由的测试接缝，不证明
真实Gateway认证、Modern L3或校园转发。

尚不能宣布 Architecture Frozen 的原因现已收窄为外部证据：当前分支没有远端required
checks、当前SHA三平台原生产物、Windows-only门或学校真实canary。因此仍是合并与发布
No-Go，而不是已知本地production缺陷。v1.2.3仍是patch release；本轮没有新增真实认证
方式或用户功能。

## 2. Baseline evidence

| Gate | 本轮实际结果 |
| --- | --- |
| Rust fmt | PASS |
| Rust Clippy workspace/all targets/features | PASS，0 warnings |
| Rust tests | 236 passed，0 failed，2 个显式 release 性能门 ignored |
| Desktop tests | 497 total；496 passed，1 Windows-only skipped |
| npm audit high | 0 vulnerabilities |
| Desktop architecture | 191 files / 240 edges / 0 cycles / Main 1596 / Renderer 524 |
| Exact Git tree secret gate | PASS |
| Main/MFA/popup/strict proxy/auth-pipe Electron | PASS |
| Remote CI for this branch | Missing |
| Current v1.2.3 Windows/Linux artifacts | Missing |
| Real HKUST canary for this exact tree | Missing |

本地 synthetic/offline 结果不等于真实 Gateway、Windows DACL、三平台 package 或学校资源
已经通过。

## 3. Confirmed strengths and invariants

| Area | Evidence | Result |
| --- | --- | --- |
| Authenticated Session boundary | `independent/src/engine/session.rs:38-77` | Session 只持有 HTTP/cookie/logout/opaque identity，Transport 单独消费 |
| Gateway origin/TLS/body | `independent/src/gateway_http.rs:65-208` | HTTPS-only、no redirect、same-origin endpoint、bounded body、typed outcome |
| Password auth cancellation | `independent/src/bin/ec-engine.rs:442-558` | Auth worker可响应 signal/control EOF/deadline，晚到 session cleanup |
| Interactive auth ownership | `independent/src/engine/{auth_transaction,auth_control}.rs` | generation/transaction/epoch/request、deadline、bounds、stale/duplicate fail-closed |
| Browser OTP safety | `desktop/campus-preload.js:61-158` | 模糊单 secret 在读 value 前拒绝；不假设 OTP 长度 |
| Child process ownership | `desktop/lib/engine-supervisor.js:135-348` | Child 到 `close` 才释放；stop single-flight + control/signal/force deadlines |
| Browser request barrier | `desktop/lib/browser-engine-barrier.js` | Engine exit 与策略切换先关闭新请求入口 |
| IPC boundary | `desktop/lib/{ipc-guard,ipc-handlers,core-control-ipc}.js` | exact owned WebContents、local file、closed bounded schema |
| Credential persistence | `desktop/lib/{credential-store,credential-settings-transaction}.js` | OS secure storage、journal、atomic/no-follow；Linux plaintext拒绝 |
| Logging | `desktop/lib/log-writer.js` | redaction、8 MiB、单轮转、三天期限、bounded tail |
| DNS source/no leak | `independent/src/engine/dns.rs` + production profile | Gateway/profile校园 DNS经隧道；system fallback disabled |
| Local frontend | `independent/src/engine/socks.rs` | loopback-only；SOCKS/HTTP/WS共享 destination policy/netstack |

这些不变量必须在任何收束重构中保留。

## 4. Findings

### A-01 — Gateway HTTP implicitly follows environment proxy

- **Evidence**：基线 `GatewaySession::new` 的 `reqwest::blocking::Client::builder()` 未调用
  `.no_proxy()`；锁定 reqwest 0.12.28 默认 `auto_sys_proxy=true`；Desktop spawn 继承环境。
- **Severity**：P1 correctness/availability/security boundary。
- **Impact**：`HTTPS_PROXY`/`ALL_PROXY` 可让 auth/config/logout 进入 Clash 或本应用尚未
  ready 的 listener；Modern raw TCP 不走同一路径，导致 control/data underlay 分裂或递归。
- **Root cause**：把 reqwest 默认值误当成 direct socket contract。
- **Recommended fix**：Gateway client 默认显式 `.no_proxy()`；未来 proxy 必须 typed、显式、
  可见，不能隐式继承环境。
- **Priority**：发布前。

### A-02 — Transport bootstrap is not cancellable

- **Evidence**：`ec-engine.rs:688-707` 同步调用 `session.rs:184-252`；其中有 blocking HTTP、
  raw/special TLS 和 `thread::sleep`，直到 listener setup 后才重新进入 control/signal select。
- **Severity**：P1 lifecycle；Architecture Frozen blocker。
- **Impact**：认证完成到 listener-ready 之间 disconnect/EOF/SIGTERM 无法及时推进；Desktop
  可能只能 force kill，远端 cleanup 未确认并与下一次登录竞争。
- **Root cause**：只为 password authentication 建立 cancellable worker，未覆盖整个 attempt。
- **Recommended fix**：ConnectionAttemptCoordinator 覆盖 Auth、Transport、Listener；每阶段
  接收 cancellation/generation，late result必须 cleanup。
- **Priority**：发布前。

### A-03 — User cancel drops cleanup-unconfirmed

- **Evidence**：`ec-engine.rs:529-547` 已计算 `cleanup_unconfirmed`，但 UserRequested 直接
  `Ok(None)`。
- **Severity**：P1 lifecycle/diagnostics。
- **Impact**：UI 把远端 cleanup 不确定当成干净停止，可能立即重连并触发 session conflict。
- **Root cause**：stop reason 与 cleanup status没有统一 terminal finalizer。
- **Recommended fix**：主 stop reason保留 user_requested，同时通过 stable secondary status
  表达 cleanup unconfirmed；自动重连不得忽略它。
- **Priority**：发布前。

### A-04 — Proxy/netstack/data-plane shutdown order is unproved

- **Evidence**：`ec-engine.rs:895-907` `services.abort_all()` 后未 drain；
  `netstack.rs:16-23` 保存 runner/bridge handles但无 shutdown/join；receive channel可无限阻塞。
- **Severity**：P1 resource lifecycle。
- **Impact**：logout 时 listener/client/bridge可能尚未退出；当前依赖进程最终退出回收，无法
  支撑可预测 shutdown 或未来进程内重连。
- **Root cause**：缺少 Serving scope 的统一 owner/finalizer。
- **Recommended fix**：close listener → drain clients → shutdown data-plane/netstack → bounded
  join → logout → stopped；为每步补时序测试。
- **Priority**：Architecture Frozen 前。

### A-05 — Desktop connection truth has multiple writers

- **Evidence**：`ConnectionStateMachine` 拥有 intent/retry/phase/generation；
  `EngineSupervisor` 拥有 child/generation；`EngineProtocolSession` 拥有 wire order；
  `main.js` 仍有二十余处手工写 `state.connected/state.connecting`。
- **Severity**：P1 maintainability/correctness risk。
- **Impact**：新异步分支容易让 UI、tray、Browser barrier、retry 和 process ownership不一致；
  当前 phase 也未区分 authenticating/preparing-tunnel。
- **Root cause**：FSM 后加，但 presentation和 orchestration没有完全迁移。
- **Recommended fix**：建立 ConnectionCoordinator/reducer；presentation纯投影；所有事件携带
  intent + generation；移除独立布尔 truth。
- **Priority**：Architecture Frozen 前。

### A-06 — Error domains share one `state.lastError`

- **Evidence**：Browser/PAC/settings 和 Engine terminal error均写同一字段；Engine close 仅在
  它为空时采用 stopped reason；Renderer连接时又会隐藏部分错误。
- **Severity**：P1 diagnostics。
- **Impact**：连接中 Browser错误不可见，并可能在稍后 Engine退出时掩盖真正终止原因。
- **Root cause**：展示字符串被同时当作 domain state。
- **Recommended fix**：拆为 connectionFailure、browserNotice、settingsNotice、recoveryState；
  统一投影决定展示优先级。
- **Priority**：发布前。

### A-07 — Whole-application lifecycle E2E is missing

- **Evidence**：Main Electron test只覆盖无凭据 UI；auth pipe test独立运行；没有真实 Main
  驱动 synthetic Engine 到 listener-ready、close、retry、explicit stop。
- **Severity**：P1 test gap。
- **Impact**：各 owner 单测均绿仍不能证明真实事件时序一致。
- **Root cause**：`connectOnce` 与 concrete main composition耦合，缺受限 test injection。
- **Recommended fix**：通过环境或 injected path选择不进包的 synthetic Engine，新增完整
  process E2E 和 stage fault matrix。
- **Priority**：Architecture Frozen 前。

### A-08 — Data-plane retry depends on English text

- **Evidence**：`session.rs:639-650` 使用错误字符串包含关系决定 transient retry。
- **Severity**：P1 error model。
- **Impact**：文案、平台 errno 或底层库升级可能改变重试安全性。
- **Root cause**：special TLS/Data Plane边界仍以 string-only error为主。
- **Recommended fix**：引入稳定 DataPlaneErrorKind；retry只读 kind，证书/MAC/protocol错误永不
  retry。
- **Priority**：Architecture Frozen 前。

### A-09 — Engine lifecycle phase is implicit

- **Evidence**：`EngineLifecycle` 主要只有 stopping bool，生产 phase由长 `run_engine` 控制流
  和事件顺序推断。
- **Severity**：P1 architecture。
- **Impact**：MFA、underlay或 failover加入后容易非法 transition、重复 cleanup或漏 terminal。
- **Root cause**：Event emitter和 connection phase owner尚未分离完成。
- **Recommended fix**：显式 Engine phase/transition table和资源 promotion；每 generation exactly
  one stopped。
- **Priority**：Architecture Frozen 前。

### A-10 — AuthBudget does not cover Password→MFA as one attempt

- **Evidence**：password deadline在 process coordinator，challenge创建新的 transaction budget；
  primary Gateway请求不扣 continuation request budget。
- **Severity**：P1 MFA activation gate；当前 password-only不构成生产绕过。
- **Impact**：未来多阶段认证可重置总时间/请求额度。
- **Root cause**：预算从 ChallengeOwner 创建，而不是从首次 Gateway auth请求创建。
- **Recommended fix**：AuthAttemptBudget从 primary request开始，并以 budgeted Gateway HTTP能力
  移交 provider/transaction。
- **Priority**：真实MFA provider激活前。

### A-11 — Credential availability is not typed

- **Evidence**：`credential-store.js::loadPassword` 把 missing、decrypt failure、Keychain拒绝和
  backend unavailable折叠为空；状态页又以 ciphertext存在表示 logged in。
- **Severity**：P1 UX/diagnostics。
- **Impact**：用户进入 dashboard后自动连接只得到误导性“需要账号密码”，无法采取恢复动作。
- **Root cause**：presence probe和 secret load没有共享 typed result。
- **Recommended fix**：`missing/decrypted/unavailable/corrupt`；状态检查不解密，连接时给稳定
  可行动错误。
- **Priority**：发布前。

### A-12 — Control Renderer crash does not recover the GUI

- **Evidence**：renderer loss已取消 pending auth，但 BrowserWindow仍可能复用空白 renderer。
- **Severity**：P1 reliability。
- **Impact**：控制界面崩溃后托盘 show可能只显示白屏。
- **Root cause**：修复只覆盖 auth cancellation，未定义 window recovery owner。
- **Recommended fix**：renderer gone后标记失效并 destroy/recreate；Electron crash E2E。
- **Priority**：发布前。

### A-13 — Package native directory is not exact

- **Evidence**：verifier拒绝 test/PKI pattern并要求目标 engine/helper存在，但允许任意其他普通
  native文件或另一架构二进制。
- **Severity**：P1 release/supply chain。
- **Impact**：陈旧、错误架构或未审查 native资源可混入包。
- **Root cause**：deny-pattern代替 exact manifest。
- **Recommended fix**：每平台只允许 expected engine、expected helper、reviewed config；拒绝额外
  文件。原生 runner做 launch smoke。
- **Priority**：发布前。

### A-14 — DNS answer owner/CNAME is not validated

- **Evidence**：`dns.rs::parse_dns_response` 验证 txid/exact question，却返回 answer section 首个
  A record；未验证 OPCODE、owner或有界 CNAME chain。
- **Severity**：P1 protocol correctness；通过加密隧道和来源校验降低攻击面。
- **Impact**：异常/错配响应可能被接受，不能宣称 strict DNS validation。
- **Root cause**：TCP fallback复用的 wire parser只完成 question校验。
- **Recommended fix**：decode canonical name；绑定 QNAME→bounded CNAME→A owner；OPCODE=QUERY；
  loop/overflow/irrelevant A tests。
- **Priority**：Architecture Frozen 前。

### A-15 — Browser `DIRECT` lacks resolved-address safety

- **Evidence**：host safety只检查 URL文本；PAC对非字面量 direct domain返回 Chromium `DIRECT`。
- **Severity**：P2 design risk；代码缺口 Confirmed，实际 rebinding exploitability尚未实测。
- **Impact**：允许直连域名若解析/重绑定到 loopback/private，pre-resolution gate无法判断。
- **Root cause**：裸 DIRECT没有受控 resolver/dialer。
- **Recommended fix**：2.0 `ControlledDirectExit`；当前先建立 threat test和限制说明，不引入 TUN。
- **Priority**：2.0 Routing Engine前。

### A-16 — Routing evaluators can drift

- **Evidence**：JS resolver和生成 PAC分别实现规则优先级；当前只有示例回归，没有大 corpus
  differential/property gate。
- **Severity**：P2 maintainability。
- **Impact**：IDN、安全 override、新 Exit加入后可能产生不同 decision。
- **Root cause**：没有版本化 RoutingPolicyIR/compiler。
- **Recommended fix**：共享 IR + 100k corpus differential gate。
- **Priority**：2.0前置。

### A-17 — Online route/interface changes are weakly observed

- **Evidence**：Desktop monitor只观察 `net.isOnline()`；Gateway HTTP、Modern raw socket和
  telemetry分别使用系统路由。
- **Severity**：P2 availability；无当前具体失败复现。
- **Impact**：Wi-Fi/Ethernet切换或 Clash TUN启停但始终 online时，恢复依赖后续 health failure。
- **Root cause**：没有 UnderlayIdentity/generation。
- **Recommended fix**：先显式 no-op/Explicit Underlay，变化后整个 Engine重启；auto detect延后。
- **Priority**：2.0 evidence-gated。

### A-18 — Documentation and capability status drift

- **Evidence**：Engine architecture仍描述 DNS仅 UDP；ROADMAP 的 Done定义要求真实证据，却对
  没有本轮 canary 的 DNS写 Done；compatibility matrix同时写当前 Gateway未下发 DNS。
- **Severity**：P1 release truthfulness。
- **Impact**：把 production wiring/synthetic pass误写成学校环境已验证。
- **Root cause**：能力状态只有单轴 Done/Partial。
- **Recommended fix**：统一 Implementation + Evidence双轴和四类事实标签；架构/spec drift gate。
- **Priority**：发布前文档收束。

### A-19 — Remote delivery/governance evidence is absent

- **Evidence**：branch无 remote/PR；main protection API未证明开启；旧 release目录不是当前
  v1.2.3包；Windows/Linux无同 SHA artifact。
- **Severity**：P0 release governance。
- **Impact**：无法获得 review、required checks、三平台 package和可复现发布证据。
- **Root cause**：本地 hardening尚未进入远端交付链。
- **Recommended fix**：用户授权后 push review branch、PR、required checks、exact-SHA clean build
  和真实 canary；此前不得 tag/release。
- **Priority**：发布硬门。

## 5. Technical debt that is not a rewrite mandate

- `desktop/main.js`、`ec-engine.rs`、`socks.rs`仍大，但已有边界和 ratchet；只沿实际生命周期/
  协议职责渐进拆分。
- Rust旧路径仍有 `Unclassified` error；禁止新跨域错误，旧代码按触达下降，不做全仓机械替换。
- Windows普通隐私文件仍主要依赖用户 profile ACL；明文 proxy sidecar已采用严格 DACL，其他
  文件后续按隐私级别扩展。
- Synthetic HTTPS Gateway尚未建立，是未来真实MFA provider前置，不是当前password-only
  v1.2.3的P0。

## 6. Audit disposition

当前没有证据支持回滚已完成的认证、浏览器、DNS TCP或 proxy hardening。正确路径是按
[`1x-convergence-plan.md`](1x-convergence-plan.md) 关闭上述 P0/P1，并使用
[`1x-release-gate.md`](1x-release-gate.md) 逐项证明，而不是再次全仓重写。

## 7. Convergence disposition

当前代码提交：`b48a6e7`。本表只关闭有当前代码和测试证据的问题；远端、平台和学校
环境证据仍保持开放。

| Finding | Disposition | Current evidence |
| --- | --- | --- |
| A-01 Gateway environment proxy | Fixed | `GatewaySession`显式`.no_proxy()`；source contract gate |
| A-02 Transport cancellation | Fixed with explicit degraded boundary | Auth/Transport持续消费control/EOF/signal/deadline；500 ms drain；无法合作结束时非零+cleanup-unconfirmed，late result不promotion |
| A-03 user cancel cleanup truth | Fixed | nonzero/secondary outcome进入Desktop `cleanExit=false`，自动重连停止 |
| A-04 serving/data-plane shutdown | Fixed locally | listener outer task drain；三socket shutdown；runner abort/await；bridge bounded join；随后logout |
| A-05 multiple Desktop truth writers | Fixed | FSM phase是唯一connected/connecting来源；Main无独立布尔写入 |
| A-06 shared error surface | Fixed | connection/settings/recovery与browser/log notice分域并统一纯投影 |
| A-07 whole Main lifecycle E2E | Fixed locally | real Electron Main全链；feature-gated真实Rust `ec-engine`完成100轮non-routing post-Transport netstack/listener/stop/join/port release；不冒充Gateway/Modern L3证据 |
| A-08 string retry | Fixed | Data Plane retry只使用stable `ErrorKind`；跨进程另有permanent/transient code，证书/MAC/协议错误不自动重试 |
| A-09 implicit Engine phase | Fixed | allowlisted Engine lifecycle含`preparing_tunnel`，非法转换typed failure |
| A-10 Password→MFA total budget | Deferred activation gate | 当前production仍password-only；真实provider前必须完成，不冒充v1.2.3功能 |
| A-11 credential availability | Fixed | missing/unavailable/corrupt/decrypt_failed typed结果和行动文案 |
| A-12 control renderer recovery | Fixed | visible/hidden renderer crash destroy/recreate；旧sender失效 |
| A-13 package native exactness | Fixed locally | exact per-platform native allowlist；wrong arch/extra/symlink/test/PKI拒绝；官方构建显式no-default-features，afterPack/verifier双重marker拒绝；原生runner尚待远端 |
| A-14 DNS owner/CNAME validation | Fixed | QR/OPCODE/question/owner/bounded CNAME/TTL/TC同resolver验证 |
| A-15 Chromium DIRECT rebinding | Accepted 1.x limitation | ADR-0002；2.0 ControlledDirectExit；未声称resolved-address隔离 |
| A-16 route evaluator drift | Partially fixed | deterministic 1,024-case JS/PAC differential；versioned IR与100k corpus保留2.0 |
| A-17 underlay change observation | Deferred evidence-triggered | `.no_proxy()`已关闭HTTP环境递归；explicit underlay保留2.0 |
| A-18 documentation drift | Fixed | ROADMAP/compatibility/architecture使用Implementation+Evidence双轴 |
| A-19 remote governance | Open release blocker | 2026-08-23只读刷新：远端不存在`codex/v1.2.3-hardening`、open PR为空、`main` protection API为404；最近CI只证明旧`0ae0d33`，不证明当前SHA |

### Current local verification

- Rust production feature set：261 passed，0 failed，2个显式release性能门默认ignored；
  lifecycle test feature：263 passed，0 failed，2 ignored；fmt和Clippy `-D warnings`通过。
- 第一方Rust所有target由Cargo `forbid(unsafe_code)`；原MTU环境测试已改为纯输入函数，
  不再通过进程级环境变量写入使用`unsafe`。
- 真实Rust `ec-engine` non-routing post-Transport soak：100/100轮通过，总耗时12.7秒，
  最慢单轮361 ms；每轮child wait、reader join、SOCKS greeting、stop和exact port重绑通过。
- Desktop：524 total，523 passed，0 failed，1个Windows-only DACL测试在macOS跳过。
- Desktop graph：194 files / 244 edges / 0 cycles；Main 1596行/35直接依赖；Renderer 524行。
- Electron：Main integration/lifecycle、toolbar、auth control、same-window/popup MFA、strict proxy、layout、20-tab、routing restart、idle全部通过。
- Offline performance：SOCKS 18/18，最大p95 1.293 ms；netstack 27/27，最大p95 6.020 ms；均不是Gateway吞吐证据。
- 每批精确暂存及最终本地候选HEAD secret gate通过；未来remote merge/tag candidate
  仍须对其exact tree重新执行。

当前未发现仍成立的本地代码级P0/P1。Architecture Frozen和Release仍为NO：远端CI、
current-SHA原生包、Windows-only门、真实HPC/Gateway、sleep/wake和网络切换证据尚未取得。
