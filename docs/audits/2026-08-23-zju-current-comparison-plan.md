# HKUST(GZ) Connect × zju-connect 当前代码复核与可维护演进方案

日期：2026-08-23（Asia/Shanghai）

> 基线说明：本文固定比较 HKUST commit `8dd0308` 与 zju commit
> `4c4b41f`，属于实施前方案，不随随后 hardening commits 改写。实际完成项、
> v1.2.3 测试和交付状态以同日最终收口审计为准。

## 1. 结论摘要

本报告把外部跨仓库审计视为调查线索，不把其中的旧 commit、目标目录或实施优先级直接当作事实。重新核对后的结论是：

> HKUST(GZ) Connect 不应成为 zju-connect 的 Rust 翻版，也不应对 zju-connect 建立源码或运行时依赖。zju-connect 适合作为协议行为样本、故障案例库和部署需求样本；HKUST 应保留自有 Rust Engine、标准 TLS、安全 secret lifecycle、Electron 产品边界和无系统污染的 proxy-first 形态，通过中立规范、独立 fixture、独立实现和本校网关证据选择性吸收能力。

近期真正值得实施的顺序是：

1. 把当前 checkpoint 送入可审查 PR 和远端三平台 CI；
2. 收束 authentication error 与 transaction 总量边界；
3. 实现隧道内、同一校园 DNS 的 TCP fallback；
4. 建立 synthetic HTTPS Gateway，测试真实 HTTP cookie/session 行为；
5. 先实现显式 underlay binding，再由真机证据决定自动探测；
6. 建立只记录行为事实的上游观察台账。

真实 Gateway MFA、aTrust、multi-line session failover、TUN、Fake IP、Android 和 forwarding 继续由学校证据或明确产品需求触发。

## 2. 审核基线与方法

### 2.1 固定基线

| 仓库 | 本次事实基线 | 状态 |
| --- | --- | --- |
| HKUST(GZ) Connect | 本地 commit `8dd030841ab4af6e578a926a0cbd5b13baa9414d` | 已提交；本地 `main` 相对 `origin/main` ahead 1；未 push |
| HKUST `origin/main` | `0ae0d33de0c3056f3f95f4a70154b74f7518f715` | GitHub 用户尚未获得本地改造 |
| zju-connect `main` | `4c4b41fee599646efc1463ecf080590724b24f28` | 2026-08-22；`fix(atrust): fix tcptunnel dest logic` |
| zju-connect release | `v1.3.0` / `901d9998a2b6fe87e251bd57448155445469927c` | 2026-08-10 发布 |

zju `v1.3.0..main` 有 52 个提交、73 个变更文件。源码在独立 `/tmp` checkout 中只读审核；没有运行客户端、登录任何学校系统、扫描网关或处理真实凭据。

### 2.2 证据等级

- **Source**：固定 commit 的实际类型、函数、调用链；
- **Test source**：存在直接测试，但不等于本次已执行；
- **Workflow**：workflow 定义和 GitHub run；构建成功不自动提升为测试成功；
- **Release**：release artifact 或 release note，只对应 release tag；
- **Inference**：基于多项 Source 的工程判断；
- **Proposal**：本仓未来设计，不冒充协议事实。

本机没有 Go toolchain，因此没有执行 zju `go test ./...`。本次确认其源码含 33 个 `_test.go`、224 个 `Test*` 和 6 个 Benchmark；同时确认三个 GitHub workflow 均未运行 `go test`、vet、lint 或 security gate。

## 3. 外部报告复核结果

### 3.1 已确认且仍成立

1. zju 的主要价值是协议覆盖、真实部署形态和网络故障经验，不是可直接复制的安全实现。
2. 当前 zju 已有 EasyConnect/aTrust、DNS UDP/TCP、underlay binding、L3/TCP tunnel、TUN、Fake IP、local DNS、TCP/UDP forwarding、Docker 和 Android AAR 的 production wiring。
3. zju EasyConnect 仍有 SMS send/submit、TOTP、certificate 和 TwfID 更新等行为线索，但这些不能证明 HKUST 使用相同 endpoint、字段、文本或 auth method。
4. HKUST 的 HTTP CONNECT/SOCKS/普通 HTTP/WebSocket/PAC/Campus Browser 已覆盖，不应从 zju 重建第二套 frontend。
5. HKUST production provider 仍是 password-only；generic MFA transaction/control/UI 不等于真实学校 MFA provider。
6. zju 的 wildcard listener、默认 NO_AUTH、secondary/public DNS、明文 CLI/config secret、session JSON、PCAP/keylog 和网络 panic 不符合 HKUST 的默认产品边界。
7. zju 为 AGPL-3.0；逐行 Go→Rust 翻译、复制请求实现/fixture 或直接依赖都不能用“换语言”规避来源和许可证问题。

### 3.2 已过期的判断

- HKUST 基线不再是 `ee75808`；generic `AuthTransactionOwner`、Control v3、resend/cancel/expiry/cooldown、Desktop challenge UI、Campus OTP/popup 安全和 proxy migration 已在 `8dd0308` 完成。
- zju 基线不再是 `e0791ec8`/v1.2.2；当前是 `4c4b41f`/v1.3.0 后 52 commits。
- zju 的测试资产已显著增长，尤其是 aTrust L3/TCP lifecycle、resolver、underlay、HTTP 和 UDP forwarding；应描述为“测试源码较丰富但 CI 不执行”，而不是“几乎没有测试”。
- HKUST Renderer 已从 1165 行降至 524；Main 为 1596 行/35 direct deps。它们是显著改善，但 Main 仍不是纯 composition-only root。

### 3.3 本次新发现或需要修正的细节

#### zju v1.3.0 与 current main 的 TLS 能力不同

v1.3.0 曾提供 `atrust-server-cert-sha256`，默认系统 CA/hostname，自签时要求 pin，并可把 fingerprint 写入 client data。current main 后续明确移除了这条 pinning path。

当前 main：

- aTrust auth HTTP `InsecureSkipVerify=true`；
- aTrust tunnel `InsecureSkipVerify=true`，并有测试明确要求不安装标准证书 callback；
- 新增 Sangfor anti-MITM challenge/signature/certificate identity 逻辑；
- 但 anti-MITM check 失败只 `log.Printf`，authentication 继续；
- anti-MITM 数据不存在或 enable 值未触发时，也没有标准 PKI 兜底。

所以准确判断是：vendor anti-MITM 行为覆盖增加了，但 current main 的 server identity 仍不满足 HKUST 的 fail-closed TLS policy，且相对 v1.3.0 的可选 pin 是能力回退。

#### zju DNS 不是简单的 “TC 后 TCP”

当前 resolver 会：

- 先发 remote UDP；
- 300 ms 后 hedge remote TCP，或 UDP error 时立即启动 TCP；
- first success 取消另一侧；
- 已证明 UDP failure 后临时偏好 TCP 10 分钟；
- remote 全失败后调用 secondary resolver；默认 secondary 可到 `114.114.114.114`。

HKUST 不应照搬 300 ms hedge 和 secondary fallback。第一版只需在同一校园 DNS 返回 `TC=1` 时，通过同一 `VirtualNetstack` 顺序启动 TCP；UDP timeout/error 是否触发 TCP应作为独立、可测试的错误策略。

#### zju underlay 的默认行为需区分库和 CLI

- `underlay.New()` 无 options 时 `AutoDetect=true`；
- production `main` 始终显式传 `conf.AutoDetectInterface`，CLI/config 默认是 `false`；
- 显式 interface 优先；auto dial失败可重新探测；绑定 required 且找不到接口时 fail-closed；
- Linux/macOS/Windows 分别使用 device/interface socket option；
- gateway hostname resolver 也可使用指定 local DNS；PCAP wrapper 和 TLS keylog 同时进入产品面。

HKUST 应吸收接口/代际边界，不吸收 PCAP、keylog、public local DNS 或 TUN 假设。

#### zju CI 的绿色含义有限

exact HEAD 的 Build、Docker、Android Actions 均成功，Build 生成 16 个架构 artifact。但 workflow：

- `permissions: write-all`；
- actions 使用 `@v2/@v3/@v4` tag；
- Android 安装 `gomobile@latest`/`go get ...@latest`；
- PR 仅 `types: opened`，更新 PR commit 不会按该定义自动重跑；
- 没有 `go test`、vet、lint、govulncheck/gosec。

因此可证明“当前 commit 能跨架构 build”，不能证明 224 个测试通过或 protocol/security regression 被 gate。

## 4. 当前能力差距与决策

| 能力 | zju current | HKUST `8dd0308` | 决策 |
| --- | --- | --- | --- |
| Generic MFA transaction/control/UI | 同步 CLI/auth package continuation | Engine-owned generic framework + synthetic pipe | HKUST 已覆盖；不重建 |
| Real EasyConnect SMS/TOTP/cert | production wiring | unsupported/fail-closed | 等 HKUST 脱敏网关证据 |
| aTrust | production auth/L3/TCP | 无证据 | 不进入近期路线 |
| Auth total steps/resends/deadline | aTrust `maxAuthSteps=8` | 单 challenge expiry/cooldown；缺总量边界 | 独立定义安全 policy，不复制数值 |
| Auth rejection vs indeterminate | 大量文本/error | auth-stage多数仍映射 `AUTH_FAILED` | 近期先修，解决假密码错误诊断 |
| DNS UDP/TCP | UDP/TCP hedge + secondary | tunnel UDP only；TC fail | 近期最高独立网络能力 |
| DNS public fallback | 默认可用 | production 禁用 | 明确拒绝 |
| Explicit underlay binding | Linux/macOS/Windows | 无 | 分阶段独立实现 |
| Auto underlay detection | opt-in production | 无 | explicit 与真机测试后再做 |
| Synthetic HTTP Gateway | zju tests使用HTTP server但为其协议服务 | 只有内存 transaction/fault harness | 应补本仓 fixture-only HTTPS Gateway |
| Multi-line/node scoring | production | 未验证 | 只建 evidence/EndpointSet 规范，不接 production |
| TUN/FakeIP/DNS hijack | production/experimental | 无、proxy-first | 近期拒绝 |
| Port forwarding | TCP/UDP | 无 | 条件功能，需明确用户需求 |
| Headless/Android/Docker | production/partial | root CLI + Desktop；Android roadmap | DNS/auth/underlay稳定后单独立项 |

## 5. 可维护架构原则

### 5.1 不复制、不链接、不运行时依赖

任何从 zju 得到的候选能力必须经过：

```text
upstream commit/path
→ 行为事实（不含代码表达）
→ 本仓中立规范
→ HKUST 自有/授权 synthetic fixture
→ 独立 Rust 实现
→ 相似度/provenance review
→ G1-G5 验证
```

禁止：复制函数/regex/response body、逐行 Go→Rust 翻译、导入 zju test fixture、直接 Go module/binary 依赖。

### 5.2 保持当前依赖方向

```text
Desktop / Headless Adapter
  → private Control/Event API
  → Authentication Orchestrator
  → AuthenticatedGatewaySession | Challenge
  → TransportBackend
  → Data Plane
  → VirtualNetstack
  → DNS / Local Frontends
```

不变量：

1. Auth 不导入 Data Plane、DNS、SOCKS/HTTP frontend；
2. Transport 只消费 authenticated session；
3. DNS/frontend 不反向依赖 auth provider；
4. Underlay 只提供 dial/resolve/interface primitives，不解释 EasyConnect/aTrust；
5. Renderer 永不持有 gateway transaction ID、Cookie、TwfID、CSRF、transport token；
6. observability 只接收 typed/redacted event，不接收 raw HTTP body；
7. 每批功能必须能通过 module/file-level revert 回滚，不改变 `special_tls11` wire bytes。

### 5.3 不做一次性目录重写

不机械采用附件的 `protocol/auth/transport/...` 大目录。只有当新增第二个真实实现或现有文件职责必须拆分时才移动：

- DNS TCP fallback 可先在 `engine/dns/` 下拆 `wire.rs`/`transport.rs`；
- underlay 可新增中性 `engine/underlay.rs` 或 `net/underlay/`，不移动所有 transport；
- synthetic Gateway 放 `tests/support/`，不进入 production module；
- frontend 内部拆分等现有 wire tests稳定后另行推进。

## 6. 分阶段实施方案

## R0：把 checkpoint 变成可审查交付

### 目标

让 `8dd0308` 获得远端、跨平台、reviewable 的证据，而不是继续在本机堆叠功能。

### 修改范围

1. 在 `.github/workflows/ci.yml` 加入 `test:campus-popup-mfa-safety`；当前它只在 tag/build workflow。
2. 为 secret scanner 增加 `--staged` 模式：用 `git diff --cached --diff-filter=ACMR` 枚举即将提交的路径，并从 Git index blob（而不是可能已再次变化的工作树文件）读取内容；不默认读取用户未暂存文件（例如 `sshr.sh`）。
3. 输出 PR change manifest：Authentication、Desktop、Proxy、Campus Browser、CI/Packaging 五个 reviewer area。
4. 从 checkpoint push review branch，不直接 push 未保护的 remote main。
5. 远端运行：Linux CI、macOS Electron、macOS/Windows/Linux package build；确认 Windows Bash step真实通过。
6. 配置 branch rules：required `ci / desktop`、`ci / desktop-electron`、`ci / engine`，至少一名 review，禁止 force push/delete；release tag/publish 单独授权。

### Commit 可审查性

`8dd0308` 是 11,210 additions / 2,281 deletions 的单一 checkpoint，代码正确性测试充分，但 review 粒度偏大。两种安全选择：

- 保留 commit，不改历史；以 reviewer-area manifest 和逐域 review弥补；
- 如维护者明确授权，在保留 checkpoint backup ref 后，把未 push commit重组为可独立测试的 Phase 0/1/2/3 commits。

未经授权不重写刚创建的 commit。

### 完成定义

- remote PR 三个 required CI jobs通过；
- build workflow 三平台完成 package verifier；
- branch protection实际启用；
- `origin/main` 仍不直接接收未经 review 的 commit；
- `sshr.sh` 不进入 index、scan、artifact。

### 回滚

PR branch可删除；remote main未变。若必须拆 commit，checkpoint ref提供恢复点。

## R1：Authentication 可靠性和总量边界

### R1.1 区分拒绝和结果不确定

新增稳定 public codes（命名可在实现评审中确定）：

- `AUTH_REJECTED`：网关明确返回账号/密码拒绝；terminal、无自动重试；
- `AUTH_INDETERMINATE`：POST 后 read timeout、connection reset、malformed/未知响应；不声称密码错误；cleanup 后允许用户手动重试；
- `AUTH_UNSUPPORTED`：未知/未实现 challenge；
- `AUTH_LIMIT_EXCEEDED` / `AUTH_EXPIRED`：本地安全 policy终止；
- `GATEWAY_UNAVAILABLE`：认证前 discovery/network failure，按 bounded transient policy处理。

不能把 `GatewayHttp` wildcard继续映射为 `AUTH_FAILED`。POST ambiguous failure 不应盲目自动重放；先 bounded logout/cleanup，再由用户明确重试。

### R1.2 Transaction policy

在 `AuthTransactionOwner` 注入独立的 `AuthPolicyLimits`：

```text
started_at: monotonic Instant
total_deadline
step_count / max_steps
resend_count / max_resends
request_count / max_requests
```

- server challenge expiry/cooldown仍是 provider metadata；
- total deadline/max counts是客户端安全上限，不冒充服务端协议事实；
- 每次新的 `ChallengeRequired` 单调增加 step；
- resend必须增加 epoch并增加 resend count；
- limit/EOF/network generation触发 `abort()`，保留主错误，logout失败作为 secondary category；
- auth等待期 control EOF必须主动 abort；Connected 后可保留现有 legacy-compatible EOF语义。

具体默认数值由本仓 threat model和 synthetic tests评审，不复制 zju 的 `maxAuthSteps=8`。

### 测试

- explicit reject / POST timeout / partial response / malformed response；
- no blind password retry；
- max step/resend/request/total deadline；
- control EOF、Renderer crash、disconnect、network generation；
- password-only behavior不变；
- every terminal path zeroize + cleanup；
- Desktop 文案不把 indeterminate显示为密码错误。

### 完成定义

用户此前观察的“正确密码被显示为密码错误且需重启”至少在 synthetic fault matrix中被分型，手动重连无需应用重启；真实根因仍需未来脱敏日志确认。

## R2：隧道内 DNS TCP fallback

### 设计原则

第一版不做 zju 式 300 ms UDP/TCP hedge，也不做 secondary/public fallback：

```text
同一 selected campus DNS
  UDP query through VirtualNetstack
    → valid answer: cache
    → TC=1: TCP to same server through VirtualNetstack
    → explicit retryable UDP transport failure: optional sequential TCP policy
    → other protocol error: fail closed
```

### 模块边界

建议先把纯 wire parser从 `dns.rs` 提取到私有 `dns/wire.rs`，再加入 `dns/tcp.rs`；`VpnDnsResolver`、cache、singleflight、server race和 `NameResolver` API保持不变。

新增内部类型：

```text
DnsQuestion { id, canonical_name, qtype, qclass }
DnsResponse::Answer { address, ttl }
DnsResponse::Truncated
DnsQueryTransportError
```

### TCP contract

- `VirtualNetstack::connect_tcp(same_server:53)`；
- 2-byte big-endian request length；
- read exactly 2-byte response length then bounded frame；
- frame上限独立评审，绝不无界分配；
- 一条 lookup共享一个总 deadline，不串行累加多个完整 timeout；
- cancellation/drop关闭 TCP；
- 校验 source server、txid、QR/RCODE、精确 canonical QNAME、QTYPE=A、QCLASS=IN；
- partial prefix/body、zero length、oversize、wrong question、wrong txid全部 fail closed；
- cache只接收完整 Answer；Truncated/error不缓存；
- 不接触 OS resolver、系统路由/DNS或public resolver。

### 测试矩阵

- UDP normal；UDP TC→TCP success；
- TCP partial length/body；oversize；wrong txid/question/type/class；
- NXDOMAIN/no answer；slow TCP；cancel；server reset；
- 多 DNS：一个 TC/TCP slow、另一个 UDP success，first valid success；
- 100 concurrent same host仍是一条 logical singleflight；
- network/Engine shutdown无 pending task/slot；
- socket observation证明 DNS TCP目标仍是校园 DNS:53；
- release latency matrix不回归。

### 完成定义和回滚

- 所有测试和性能门通过；
- `TC=1` 不再失败；
- campus DNS不可用时没有系统/public DNS流量；
- TCP path可由内部 feature flag短期关闭，关闭后回到当前 TC typed error，而不是public fallback。

## R3：Synthetic HTTPS Gateway

### 目标

当前 `fake_gateway_faults.rs` 只证明 transaction ownership。新增 test-only HTTPS server，验证真实 `GatewaySession` cookie jar、HTTP body/status、partial session和 TLS policy。

### 组织

```text
independent/tests/support/
  synthetic_gateway.rs
  synthetic_ca.rs
  scenarios.rs
independent/tests/gateway_auth_http.rs
```

- 只作为 dev-dependency/test target；
- fixture路径和字段明确 `fixture_*`，不猜 `/auth/sms` 或复制 zju endpoint；
- 使用本仓生成的测试 CA，positive case显式信任；错 CA/hostname/expiry/pin为negative cases；
- package verifier继续拒绝 test binary/fixture进入发行包。

### Scenario DSL

```text
password_only
challenge_required(kind=generic)
challenge_update(epoch)
wrong_response(retryable metadata)
resend / expiry / cancel
cookie/csrf/opaque continuation rotation
partial body / reset / timeout / malformed / oversize
logout failure
auth success + L3 failure
control EOF / process shutdown
```

测试日志只能记录 scenario/step/category；server收到的 secret值不得进入 assertion failure文本。

### 完成定义

- GatewaySession的 cookie/redirect/origin/TLS contract有 HTTP-level tests；
- partial session每个终态都 cleanup；
- raw response/Cookie/CSRF/secret不进入 event/log；
- 仍不宣称支持学校 MFA。

## R4：显式 Underlay Binding

### R4.1 先建立统一 dial boundary

引入 backend-neutral `GatewayDialer` / `UnderlayPolicy`，供以下路径共同使用：

- Gateway HTTPS discovery/auth/logout；
- Modern token/config；
- Modern data-plane send/recv/address/lease sockets；
- gateway hostname resolution/selected resolved address。

默认 `UnderlayPolicy::SystemDefault` 保持现有行为；显式配置才启用 binding。

### R4.2 显式接口模式

```text
UnderlayPolicy::Explicit {
  interface_identity,
  bind_required: true,
}
```

- Linux：`SO_BINDTODEVICE`；
- macOS：`IP_BOUND_IF` / `IPV6_BOUND_IF`；
- Windows：`IP_UNICAST_IF` / `IPV6_UNICAST_IF`；
- binding失败或接口不存在时 fail-closed，不退回未绑定 socket；
- SNI/标准PKI/pin按原 host执行，不能因预解析 IP关闭hostname验证；
- gateway host resolution结果与 connection generation绑定；切换时重新解析；
- 不修改系统路由、系统DNS或全局代理。

第一版可以只承诺“gateway sockets显式绑定”；接口作用域 DNS若平台上不能安全保证，应在 UI/文档显示限制，不能假装同一 underlay 已完整覆盖 resolver。

### R4.3 Network generation

`UnderlayIdentity` 进入 Engine generation。任何 interface/network change：

1. 使旧 auth command/stale challenge失效；
2. abort pending auth并bounded logout；
3. 关闭旧 data plane/DNS/frontend；
4. 重新选择/验证 interface；
5. 重新认证，不迁移 Cookie/token。

### 测试

- fake socket binder unit；显式存在/不存在/权限不足；
- macOS/Windows/Linux compile+真机 socket inspection；
- interface切换时旧 generation不能发网关或DNS请求；
- Clash TUN/其他VPN coexistence；
- hostname TLS仍验证；
- no fallback to unbound socket。

### 自动探测延后

只有 explicit binding在三平台稳定后增加 `AutoPhysical`：

- 排除 loopback、down、TUN/VPN、Engine虚拟IP所在接口；
- minimum dwell/hysteresis；
- UI显示选择结果并允许 override；
- 找不到可用接口时若 bind-required则fail-closed；
- 不加入 PCAP/keylog/local public DNS。

## R5：Upstream 行为观察与条件能力

建立 `docs/compat/upstream-observations/zju-connect.md` 或等价结构化 ledger：

```text
upstream commit/tag
affected paths
behavioral fact
HKUST relevance
primary evidence needed
independent spec/test
decision: covered/adapt/wait/reject
license/provenance disposition
```

scheduled workflow只读取公开 commit metadata和diff path，生成候选 issue/报告；不下载二进制到发行链、不复制源码/fixture、不自动改 production code。

条件能力：

- Headless foreground：有服务器/HPC需求后，复用 private pipe/owner-only OS control；
- loopback TCP forwarding：有不能使用 SOCKS/PAC 的真实应用后独立立项；
- Android：Auth/underlay async core稳定后，以 opaque handle + VpnService/Keystore实现；
- EndpointSet/multi-line：必须证明 auth/data endpoint关系和token portability，默认failover重新认证。

近期拒绝：aTrust backend、TUN/FakeIP/DNS hijack、public DNS fallback、Shadowsocks、wildcard listener、TOTP seed保存、gateway session ordinary-file persistence、PCAP/TLS keylog。

## 7. CI、发布与维护门

每个 batch 都必须通过：

| Gate | 必需结果 |
| --- | --- |
| Rust | fmt、Clippy `-D warnings`、full tests、module boundary |
| Desktop | full Node tests、architecture/cycle、all JS syntax、secret gate |
| Electron | Main、same-window MFA、popup MFA、strict proxy、layout、restart/idle |
| Network | DNS/proxy fault、cancellation、no-leak、release latency matrix |
| Package | 三平台 native architecture、asar topology、fixture exclusion、签名分类 |
| Real environment | 仅在功能需要时使用授权 canary；不自动重试密码/OTP |

维护 ratchet：

- `main.js` 不得超过 1596 行/35 direct deps；
- `renderer/app.js` 不得超过 524 行；
- 新 module不引入环；
- `dns.rs`/`ec-engine.rs`/`socks.rs` 新增职责前先提取已有职责；
- production dependency新增必须说明为什么现有依赖不能满足；test-only server依赖必须是 dev-only；
- 每个 phase 一个主行为，不能把 DNS、underlay、MFA provider和目录重排放入同一 PR。

## 8. 推荐 PR 序列

| PR | 内容 | 风险 | 依赖 |
| --- | --- | --- | --- |
| PR-0 | popup E2E进 CI、staged secret mode、review manifest | 低 | checkpoint |
| PR-1 | auth rejected/indeterminate typed codes | 中 | PR-0 |
| PR-2 | AuthPolicyLimits + auth-stage control EOF abort | 中 | PR-1 |
| PR-3 | DNS wire parser提取 + exact question tests | 低中 | PR-0 |
| PR-4 | DNS same-server TCP fallback | 中 | PR-3 |
| PR-5 | synthetic HTTPS Gateway/CA/scenarios | 中高，test-only | PR-1/2 |
| PR-6 | GatewayDialer interface + default no-op | 中 | PR-4/5 |
| PR-7 | explicit interface binding三平台 | 高 | PR-6 + device matrix |
| PR-8 | auto physical interface detection | 高、条件 | PR-7 + soak |

PR-1/2 与 PR-3/4 可在独立分支并行设计，但 merge时都必须基于同一 remote CI绿色 checkpoint。

## 9. 成功指标

### 短期

- `8dd0308` 进入受保护、required-checks的 main；
- Windows/Linux/macOS package由远端实际验证；
- popup MFA在普通 CI而非只在 release build；
- auth indeterminate不再显示为密码错误；
- staged secret gate覆盖即将提交的新文件。

### 中期

- DNS TC经同一校园DNS TCP成功，无系统/public query；
- Auth total deadline/step/resend有界；
- synthetic HTTPS Gateway覆盖cookie/partial session/TLS；
- explicit underlay在三平台fail-closed且不修改系统网络。

### 长期/证据触发

- 学校启用某一种MFA后，只为该方法实现provider并通过G1-G4；
- multi-line/aTrust/TUN/Android只有在真实证据/需求和独立安全评审后进入；
- zju更新只产生观察记录，不成为供应链或源码依赖。

## 10. 当前明确限制

- 本次未运行 zju Go tests，因为本机无 Go toolchain；GitHub绿色run只含build，不含test。
- 未登录或探测HKUST/ZJU网关，未复现实校MFA、DNS、underlay或aTrust。
- 许可证结论是工程风险判断，不替代法律意见。
- HKUST commit只在本地；未push、未触发远端CI、未修改branch protection。
- `sshr.sh` 全程未读取、未暂存、未提交；随后按用户明确要求从工作树删除。

## 11. 主要公开证据

- zju current repository/main：<https://github.com/Mythologyli/zju-connect/tree/4c4b41fee599646efc1463ecf080590724b24f28>
- zju v1.3.0：<https://github.com/Mythologyli/zju-connect/releases/tag/v1.3.0>
- v1.3.0 → current 52 commits：<https://github.com/Mythologyli/zju-connect/compare/v1.3.0...4c4b41fee599646efc1463ecf080590724b24f28>
- exact HEAD Build run：<https://github.com/Mythologyli/zju-connect/actions/runs/32582097935>
- current EasyConnect request：<https://github.com/Mythologyli/zju-connect/blob/4c4b41fee599646efc1463ecf080590724b24f28/client/easyconnect/request.go>
- current aTrust auth：<https://github.com/Mythologyli/zju-connect/blob/4c4b41fee599646efc1463ecf080590724b24f28/client/atrust/auth/auth.go>
- current aTrust TLS：<https://github.com/Mythologyli/zju-connect/blob/4c4b41fee599646efc1463ecf080590724b24f28/client/atrust/tls.go>
- current DNS resolver：<https://github.com/Mythologyli/zju-connect/blob/4c4b41fee599646efc1463ecf080590724b24f28/resolve/resolver.go>
- current underlay：<https://github.com/Mythologyli/zju-connect/blob/4c4b41fee599646efc1463ecf080590724b24f28/internal/underlay/dialer.go>
- current build workflow：<https://github.com/Mythologyli/zju-connect/blob/4c4b41fee599646efc1463ecf080590724b24f28/.github/workflows/build.yml>
- GNU GPL/AGPL compatibility FAQ：<https://www.gnu.org/licenses/gpl-faq.en.html>
