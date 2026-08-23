# HKUST(GZ) Connect 当前 `main` 深度复核

日期：2026-08-22（Asia/Shanghai）
唯一代码事实：`main` / `0ae0d33de0c3056f3f95f4a70154b74f7518f715`
远端核对：`origin/main` 在审计开始时解析为同一 SHA
工作树边界：用户既有未跟踪文件 `sshr.sh`，本次不读取、不修改、不纳入结论

## 1. 复核方法与范围

附件报告基于旧 SHA `ee758088fd6436f5de1e7a0cf798ed55dcb24044`，本报告只把它当作调查线索。结论来自当前源码、依赖锁、测试、GitHub Actions、构建脚本和本机复跑结果，不以 README、ROADMAP 或旧报告作为代码事实。

当前 tracked files 共 259 个：`desktop/` 166、`independent/` 71、`docs/` 10、`.github/` 3，其余 9。主要现行规模：

| 文件 | 行数 | 现行职责判断 |
| --- | ---: | --- |
| `desktop/main.js` | 2342 | composition、状态、连接、Engine、Browser、routing、安全、IPC 混合 |
| `independent/src/engine/socks.rs` | 1515 | listener、SOCKS、HTTP 分派、UDP、relay 混合 |
| `desktop/renderer/app.js` | 1165 | 连接、资源、路由、设置、日志、更新、dialog 混合 |
| `independent/src/engine/socks/http_forward.rs` | 1113 | 较大但内聚的 HTTP framing/forwarding |
| `independent/src/probe.rs` | 1019 | probe workflow 与生产 Gateway HTTP session 混合 |
| `desktop/lib/campus-browser.js` | 1009 | Browser shell、tab、routing、credential、certificate 协调 |
| `independent/src/bin/ec-engine.rs` | 1026 | CLI、认证、transport、listener、control、supervision 混合 |

静态 CommonJS 图覆盖 147 个 JS 文件、194 条相对依赖边，当前未发现静态环。`desktop/main.js` 仍直接依赖 44 个本地模块，含 70 个顶层函数；`renderer/app.js` 含 56 个顶层函数。当前“无环”尚未被 CI 架构门保护。

## 2. 当前真实边界与数据流

```text
Control Renderer
  -> allowlisted preload IPC
  -> desktop/main.js application orchestration
  -> inherited private stdin/stdout/stderr
  -> Rust ec-engine
     -> ProductionPasswordAuthProvider
     -> AuthenticatedGatewaySession
     -> ModernL3TransportBackend
     -> EasyConnectDataPlane
     -> VirtualNetstack
        -> VPN DNS
        -> loopback SOCKS/HTTP/UDP frontend
```

正确且应保留的边界：Renderer 不持有 gateway cookie/TwfID/CSRF/Modern token；Engine 配置和凭据不经 argv/env；Gateway HTTPS 强制 HTTPS、拒绝重定向并使用标准证书验证；Data Plane 失败普遍 best-effort logout；DNS/SOCKS/UDP 共用 destination policy；IPv6 未实现时明确拒绝；Browser 在 Engine 释放 listener 前先关闭 request gate。

当前反向依赖：`independent/src/engine/session.rs` 从 `crate::probe` 导入生产 `GatewaySession`。当前认证对象还持有 transport-specific `ModernSessionId`。

## 3. 外部 finding 逐项复核

### F-01（P1）VPN Gateway MFA：成立

- 路径/对象：`independent/src/engine/provider.rs::{AuthProvider, AuthOutcome, NoAuthChallenge}`；`independent/src/engine/session.rs::ProductionPasswordAuthProvider`；`independent/src/bin/ec-engine.rs::run_engine`；`desktop/main.js::startControlHandshake`。
- 实际行为：provider 只公布 password，challenge 类型不可构造；二次认证返回稳定的 unsupported 并 logout。Rust 在认证前启动 stdin reader，但控制 exchange 只在认证、Modern L3、netstack、listener 完成后消费；Desktop 也只在 `listener_ready` 后发 hello。Control v2 只有 shutdown/cancel/close 且明确 secret-free。
- 风险：Gateway 要求 MFA 时所有连接 fail-closed 失败；没有 partial session continuation、respond/resend/cancel 或 challenge UI。
- 建议：修改。先建立 Engine-owned auth transaction、sanitized challenge event 和显式 secret-bearing control extension；认证完成后仍产出同一 `AuthenticatedGatewaySession`，不改 Data Plane。

### F-02（P1）Campus Browser MFA：成立

- 路径/对象：`desktop/campus-preload.js::{loginPasswordInput, credentialFromForm, pageCredentialState, createSpaCredentialMonitor}`；`desktop/lib/credential-controller.js::{markNavigation, confirmPageState}`。
- 实际行为：任意单个 `input[type=password]`（非 change/reset）会被当作登录密码；页面状态只有 `hasLoginForm`。成功 HTTPS navigation/redirect 后，只要密码框消失即可 offer；SPA 也以密码表单稳定消失作为成功证据。
- 风险：OTP 页面可能触发提前保存；OTP 若使用 password input，可能被填入校园密码或成为保存候选；MFA 未完成时可误判 post-login。
- 建议：立即修改。加入不依赖固定长度/endpoint 的 challenge field/form 分类；challenge 页面阻止 autofill、candidate 和成功确认。

### F-03（P1）本地代理默认授权：成立

- 路径/对象：`desktop/lib/settings-store.js::{DEFAULTS, normalizeSettings}`；`desktop/main.js::connectOnce`；`independent/src/engine/socks_auth.rs::ProxyAuthenticationMode`；根脚本 `hkustgzconnect::run_engine`。
- 实际行为：Desktop 默认 `strictProxyAuth=false`，普通用户进入 Engine `None`；若以前复制过稳定 credential，则是 `Optional`，仍接受 NO_AUTH。根 CLI 未传任何 proxy-auth flag。listener 限制 loopback，但 NO_AUTH 可被同机其他进程/用户复用；None/Optional 保留 UDP ASSOCIATE。
- 风险：本机不可信进程或共享主机的其他用户可复用已认证校园会话。
- 建议：修改。新安装默认 strict；保留用户已经明确保存的兼容选择；兼容模式改为显式降级。CLI 另建可回归的稳定 credential contract 后再收口，不能用无法审计的临时 shell secret 拼接。

### F-04（P2）Desktop Main 架构：成立

- 路径/对象：`desktop/main.js`。
- 实际行为：2342 行、44 个直接本地依赖、70 个顶层函数，同时拥有应用、连接、Engine、Browser、routing、credential、certificate、telemetry、IPC 状态。
- 风险：生命周期顺序和跨域状态容易互相破坏；MFA 会进一步扩大隐式 callback graph。
- 建议：修改，但只做按行为边界的渐进提取；先建立大小/依赖不增长门。

### F-05（P2）Renderer 架构：成立

- 路径/对象：`desktop/renderer/app.js`。
- 实际行为：1165 行、56 个顶层函数，共同管理连接、资源、路由、设置、日志、更新和 dialog。
- 风险：难以加入隔离的 auth-challenge flow，UI 状态回归面大。
- 建议：修改；先按 feature 提取纯状态/视图函数并保持 preload API 不变。

### F-06（P2）Rust 边界：成立

- 路径/对象：`independent/src/engine/session.rs::{AuthenticatedGatewaySession, ModernL3TransportBackend}`；`independent/src/probe.rs::GatewaySession`。
- 实际行为：生产 session 反向依赖 `probe::GatewaySession`；所谓 auth-only session 持有 `ModernSessionId`，transport 用它取 token。
- 风险：partial auth、authenticated context 和 transport ownership 难以独立演进/替身测试。
- 建议：修改。先把 Gateway HTTP session 下沉到中性生产模块，再分离 auth continuation 与 transport bootstrap；不移动 `special_tls11` 字节实现。

### F-07（P2）Rust error model：部分成立

- 路径/对象：`independent/src/lib.rs::Error(pub String)`；`engine/provider.rs::ProviderError`；`engine/event.rs::EngineErrorCode`。
- 实际行为：核心错误仍是 string-only，source/kind 丢失；provider capability error 和 Desktop-facing Engine code 已提供局部 typed mitigation。
- 风险：内部 retry/cleanup 决策和未来 invalid/expired/rate-limit 分类仍可能依赖字符串。
- 建议：增量修改。先为 auth/session/transport 增加稳定 kind 和 source，不一次性重写全 crate。

### F-08（P2）Rust proxy frontend：成立

- 路径/对象：`independent/src/engine/socks.rs` 与 `socks/http_forward.rs`。
- 实际行为：`socks.rs` 同时拥有 accept/concurrency、SOCKS negotiation/auth、TCP、HTTP dispatch、UDP association 和 relay。
- 风险：一种 frontend 的修改可能影响另一协议或认证政策。
- 建议：测试稳定后按 listener/auth/socks5/http/udp/relay 拆模块；不先动协议行为。

### F-09（P2）Session liveness：部分成立

- 路径/对象：`ec-engine.rs::wait_for_unhealthy`；`VirtualNetstack::is_healthy`；`desktop/main.js::checkTunnelHealth`。
- 实际行为：Engine 已能发现 netstack/data-plane unhealthy；Desktop 并发探测两个 SOCKS target 并按持续失败恢复。没有 server session expiry/keepalive 的 typed 事件，也没有区分 authenticated-session expiry 与黑洞。
- 风险：部分 half-open/session-expired 故障仍依赖外部探测，诊断和恢复延迟。
- 建议：先加 fake/fault injection，再增加 typed liveness，不直接改线上 transport。

### F-10（P2）Credential projection：成立

- 路径/对象：`desktop/lib/external-proxy-config.js::ensureProxyCredentialSidecar`；`private-file.js::ensureOwnerOnly`；`main.js::copy-clash-node`。
- 实际行为：stable master 使用 safeStorage 加密；SSH helper sidecar 在 listener 生命周期内是 owner-only 明文；Clash YAML 写 OS clipboard。Windows 路径跳过 Unix mode/link 约束，`fchmod(0600)` 不验证 DACL。
- 风险：共享账户、备份/索引、clipboard history 或宽 DACL 可暴露本地代理凭据。
- 建议：Windows 增加用户 DACL 验证；clipboard 加显式敏感提示/可选清理或受保护文件导出；保留现有 fail-closed secure-storage 行为。

### F-11（P2）Certificate trust：成立

- 路径/对象：`campus-certificate-trust.js::CampusCertificateTrustStore`；`certificate-controller.js::promptAndTrust`。
- 实际行为：用户确认后持久保存 exact origin + SHA-256 fingerprint + updatedAt；没有允许覆盖的 Chromium error allowlist，也没有 grant expiry/session-only 默认。
- 风险：expired/hostname mismatch 等不同失败类别可获得长期同等授权。
- 建议：限制可覆盖 error 类别，增加 session-only 默认与过期；保留 changed-fingerprint race fail-closed。

### F-12（P2）Legacy TLS：成立但受协议约束

- 路径/对象：`independent/src/modern.rs`；`special_tls11.rs`。
- 实际行为：存在 TLS 1.1 / `TLS_RSA_WITH_RC4_128_SHA` 隔离 adapter，并有证书、Finished/MAC、heartbeat 和 record tests。
- 风险：不具备现代 TLS 属性。
- 建议：不在缺少新网关证据时改写；继续隔离、监测并在网关升级后关闭。

### F-13（P2）Release governance：成立

- 路径/对象：`.github/workflows/build.yml` 与 GitHub branch settings。
- 实际行为：actions 均 commit-pin；build matrix 无写 token，单独 release job 才有写权限。实时 API 返回 `Branch not protected`。macOS 无证书时允许 ad-hoc，Windows signing secret 也可缺失，tag 仍可发布。
- 风险：CI 不是 required gate；正式 tag 可发布未正式签名产物。
- 建议：启用 branch protection/required checks；正式 release 缺签名时 fail，unsigned 只允许显式 prerelease。

### F-14（P2）Tests/CI：成立但现有基础较强

- 路径/对象：`desktop/test` 72 文件、`desktop/e2e` 7 文件、`independent/tests`、三份 workflow。
- 实际行为：已有大量 unit、真实 Electron、fmt/clippy/test、release-mode performance guard、三平台 package verification；缺 JS lint/format/cycle/architecture gate、coverage、fake gateway 和 MFA fault matrix。
- 风险：God Module、循环依赖、challenge 状态机和 secret vocabulary 回归不能被当前 gate 全面阻止。
- 建议：先加无新依赖的 cycle/size/dependency baseline gate；MFA framework 前加 fake gateway/fault injection。

### F-15（P2）MFA secret logging：成立

- 路径/对象：`desktop/lib/log-writer.js::redactDiagnosticText`。
- 实际行为：已覆盖 authorization/cookie/password/token/code URL 等，但未覆盖 `otp`、`one_time_code`、`verification_code`、`passcode`、`TwfID`、`csrf` 等 key/value 与 query 名称。
- 风险：未来错误文本可能把 OTP/continuation metadata 落盘。
- 建议：立即扩展通用 redactor 并加 negative tests；协议层仍必须禁止输出 secret。

### F-16（P3）Repository structure：成立

`desktop/lib` 和 `desktop/test` 仍平铺；`independent` 同时是生产 Engine 与兼容性研究工具；`android` 仍只有 README。建议按真实 ownership 渐进迁移，不整仓改名。

### F-17（P3）IPv6：成立且当前 fail-closed

SOCKS TCP/UDP 和 HTTP authority 明确拒绝 IPv6；未发现 IPv6 direct fallback。保持拒绝，直到 Data Plane 端到端支持。

## 4. 本次新增问题

1. **设置迁移注释与实现矛盾（P2，归入 F-03）**：`settings-store.js` 的 recovery 注释称 legacy document 会迁移到 strict，但 `normalizeSettings` 实际把缺少当前 security version 的设置归为 compatibility。该歧义会让安全迁移继续被误读。
2. **根 CLI 是独立的未认证入口（P1，归入 F-03）**：即使 Desktop 默认改严，`hkustgzconnect::run_engine` 仍不传 proxy auth。CLI 必须单独设计 credential 交付和测试，不能被 Desktop 修复掩盖。
3. **Release 缺 checksum/SBOM（P3）**：release job 只附加 DMG/EXE/AppImage，没有发布 SHA-256 manifest 或 SBOM；在允许 unsigned/ad-hoc 产物时尤其不利于独立校验。
4. **CI 的 JS 结构检查只覆盖少数入口（P2，归入 F-14）**：当前 syntax step 没有遍历全部 147 个 JS 文件，也没有 module cycle/size budget。

未发现 tracked private key、GitHub token、OpenAI key、AWS access key 或旧测试账号标识。该扫描只证明当前 tracked tree 未匹配这些模式，不等同于完整 secret scanner/SBOM。

## 5. 现有验证结果

本机环境：Node 25.9.0 / npm 11.12.1；Rust 显式使用仓库固定 toolchain 1.97.1。GitHub 当前 SHA 的 `ci` run `32551114877` 在 Node 24 / hosted runners 上成功。

| 命令 | 结果 |
| --- | --- |
| `npm test` | 410 passed / 0 failed |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| 六个 JS entry `node --check` + 四个 shell `bash -n` | 全通过 |
| Electron main/toolbar/strict proxy/layout/browser soak/routing restart/idle baseline | 全通过 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo clippy --locked --all-targets -- -D warnings` | 通过 |
| `cargo test --locked` | 180 passed / 0 failed / 2 ignored |
| release SOCKS performance matrix | 18/18 cells 通过；最大 p95 2.290 ms |
| release netstack latency matrix | 27/27 cells 通过；最大 p95 6.275 ms |
| `cargo build --locked --release --bin ec-engine --bin ec-proxy-command` | 通过 |

这些是离线/合成与本机 Electron 证据，不声称真实学校 Gateway MFA、真实 MFA endpoint、生产签名或所有真机平台已验证。

## 6. 按风险与依赖排序的实施计划

### Batch 0：无运行行为变化的回归门

- 加 JS cycle + `main.js`/Renderer 行数和直接依赖不增长 gate；接入 CI/build。
- 扩展 MFA secret redaction 和测试（只改变日志安全过滤，不改变协议）。
- 完成定义：当前结构不得继续扩大；无新增依赖；全量 unit/Electron/Rust 回归绿。

### Batch 1：当前已存在的 P1 安全边界

- 新安装默认 strict local proxy auth；保留当前 security-version 已保存的显式兼容选择；兼容模式仍可手动 opt-in。
- Campus Browser 增加 generic challenge classifier：不猜 endpoint/验证码长度/渠道；OTP/challenge 不 autofill、不生成 candidate、不成为 post-login 证据。
- 完成定义：password-only 普通页面回归；MFA synthetic DOM 覆盖 text/password/one-time-code/SPA/navigation；Desktop strict E2E 通过。
- 本批不把根 CLI 假装成已修；CLI credential contract 单独实现和验证。

### Batch 2：Rust ownership 与 typed failures

- `GatewaySession` 从 `probe` 下沉；拆 authenticated context 与 Modern bootstrap；为 auth/session/transport 引入稳定 ErrorKind/source。
- 不改 wire bytes、TLS 1.1 adapter、Modern token endpoint 或 Data Plane 行为。

### Batch 3：通用 MFA framework

- Engine-owned `AuthTransaction`；sanitized challenge DTO/event；显式 secret-bearing control extension；respond/resend/cancel；generic UI；OTP zeroization 生命周期。
- 先有 fake gateway、duplicate submit、cancel、timeout、restart、network loss、challenge 后 L3 failure tests，再接生产 wiring。
- 未知 challenge 始终 fail-closed。

### Batch 4：其余 P2 hardening

- Windows DACL、clipboard/sidecar、certificate error allowlist/expiry、session liveness fault injection、Desktop/Renderer feature extraction、proxy frontend 拆分、release signing/checksum/SBOM。

### Batch 5：学校真实 rollout 后的适配

- 仅基于批准账号和脱敏证据实现真实 adapter；不猜 `/auth/sms`、验证码长度、SMS/email 映射、TwfID/CSRF mutation 或 resend contract。

## 7. 本轮明确不修改

- 不实现或猜测任何真实学校 MFA endpoint/字段/验证码规则。
- 不改 `special_tls11`、Modern token/Data Plane、netstack、DNS wire behavior。
- 不删除 compatibility mode、现有 logout/zeroize/request-gate/IPv6 fail-closed 行为。
- 不修改用户未跟踪文件 `sshr.sh`，不推送、不发 release、不变更 GitHub branch settings。

## 8. Batch 0/1 实施记录

本节记录审计完成后在同一工作树实施的首批改进；它们尚未改变本报告开头固定的审计 SHA。

### 已完成

1. `desktop/scripts/check-architecture.js` 建立无新依赖的 CommonJS cycle gate，并把 `main.js` 直接依赖、`main.js` 行数、Renderer 行数固定为“只能下降、不能增长”的 debt baseline；CI 与 tag build 均执行。
2. proxy security schema 从 v2 升到 v3：新安装和无可信 version 的配置默认 strict；v2 已保存的 strict/compatibility 选择均保留；已知有问题的 v1 自动 strict 继续修复为 compatibility。兼容模式没有被删除。
3. Campus Browser 加入 generic challenge classifier，输入仅来自 bounded DOM metadata/page hints，不读取 challenge value，不依赖 endpoint、OTP 长度或渠道：
   - `autocomplete="one-time-code"`；
   - OTP/TOTP/MFA/2FA/passcode/verification/code 等字段语义；
   - password-shaped OTP 的 form/page challenge 语义；
   - push/approve-device 页面语义；
   - navigation 与 SPA challenge completion。
4. challenge page 不执行校园密码 autofill、不生成 password candidate、不成为 post-login 证据。Candidate 仍受原 90 秒 TTL 和所有 lifecycle clear/zeroize 约束。
5. log redactor 增加 OTP/TOTP/one-time-code/verification-code/passcode/TwfID/CSRF（含 query、key/value 和 JSON-like key）词汇。
6. 新增真实 Electron synthetic HTTPS fixture `campus-mfa-safety.electron.js`，不使用网络、学校 endpoint、真实账号、cookie 或 OTP。

### 修改范围

- CI/architecture：`.github/workflows/{ci,build}.yml`、`desktop/package.json`、`desktop/scripts/check-architecture.js`、`desktop/test/architecture-gate.test.js`。
- Browser MFA safety：`desktop/campus-preload.js`、`desktop/lib/credential-controller.js`、对应 unit tests 与 `desktop/e2e/campus-mfa-safety.electron.js`。
- Proxy default/docs：`desktop/lib/settings-store.js`、Renderer i18n、README、`desktop/SECURITY.md` 与设置/Renderer tests。
- Redaction：`desktop/lib/log-writer.js` 与 tests。
- 未修改 Rust authentication/transport/Data Plane/DNS/SOCKS wire implementation。

### 修改后验证

| 命令/门 | 结果 |
| --- | --- |
| `npm test` | 420 passed / 0 failed |
| `npm run check:architecture` | 150 JS files、195 edges、0 cycles；growth caps 通过 |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| 全套 Electron（含 MFA safety、strict proxy、browser soak） | 全通过 |
| Rust fmt/clippy/test/release build | 180 passed / 0 failed / 2 ignored；build 通过 |
| macOS arm64 `electron-builder --mac dir` | 通过 |
| packaged resource/signature verification | darwin/arm64、Apple local signature 通过 |
| app.asar 内容核对 | v3 strict default 与 challenge classifier 均已打包 |

Electron 的 blocked-port E2E 会按设计输出 `ERR_UNSAFE_PORT` 诊断；一次 macOS `TASK_SUPPRESSION_POLICY` 系统日志不影响测试结果。它们不是 Gateway/网络失败。

### 安全与兼容性影响

- 新安装不再默认暴露 NO_AUTH loopback proxy；当前 v2 用户不会被静默切换，避免升级后破坏已有 Clash/SSH。
- strict mode 继续禁用 UDP ASSOCIATE；显式 compatibility mode 仍保留原 NO_AUTH/UDP 行为。
- OTP/challenge secret 不进入 vault、settings、clipboard 或新增日志路径；Renderer 仍不接触 Gateway session secret。
- password-only Browser login、跨域 SSO navigation 和现有 SPA password login 均有回归测试。

### 尚未解决

- 根 CLI 在 Batch 0/1 结束时仍以 NO_AUTH 启动；该缺口随后已由第 9 节记录的 Phase 2 批次关闭。
- Gateway MFA transaction、challenge event/control/UI 仍未实现；当前仍正确 fail-closed。
- Main/Renderer/Rust ownership、typed errors、Windows DACL、certificate expiry、release governance 仍按第 6 节推进。

## 9. Phase 2：CLI 授权边界、Rust ownership 与 typed errors

### 已验证的问题

1. 根 CLI 直接使用 `ec-engine --credentials-stdin --socks-bind`，没有 proxy-auth flag；Desktop 的 security schema 无法保护该独立入口。
2. `engine/session.rs` 和 `engine/socks_auth.rs` 分别从 `probe` 导入生产 Gateway HTTP session 与 credential parser，F-06 的 dependency inversion 成立且不只一处。
3. 全局 `Error(pub String)` 使 provider 以外的 kind/source 丢失；Engine 虽有稳定 event code，但 auth configuration 与普通 auth failure 在 provider boundary 仍不可区分。

### 修改过的文件与核心设计

- CLI：根 `hkustgzconnect`、`tools/mac-cli/proxy-credential.sh`、`desktop/test/cli-proxy-auth.test.js`。
  - CLI 默认传四行 bounded stdin 并启用 `--socks-auth-stdin`；不再启动 NO_AUTH listener。
  - 随机 local-proxy credential 使用与 Rust helper 相同的三行 sidecar：`endpoint / username / password`。
  - sidecar 必须是 0600、单硬链接、非符号链接、三行且字段 bounded；端口变化只原子更新 endpoint，不轮换 secret。
  - `test` 改走 `ec-proxy-command --credential-file`；`proxy-config` 是唯一显式显示该本地凭据的命令。
  - VPN password 仍从 Keychain 读入 stdin，不进入 argv；本地 proxy credential 不是校园账号密码。
- Rust ownership：新增 `independent/src/{gateway_http,credentials}.rs`，调整 `probe.rs`、`watch.rs`、`engine/{session,socks_auth}.rs` 和 `lib.rs`。
  - `GatewaySession` 现在由中性 `gateway_http` 拥有；它只依赖 HTTPS/XML 基础，不依赖 probe、Modern、Data Plane、DNS 或 local frontend。
  - `endpoint_url` 同步下沉并由 `watch` re-export，保持已有公共路径兼容。
  - bounded credential stdin 下沉到 `credentials`；`probe` re-export 保持 `ec-probe` 调用面不变。
  - `independent/tests/module_boundaries.rs` 递归阻止任何 production `engine/` 再导入 `crate::probe`。
- Typed errors：`independent/src/lib.rs`、`engine/{provider,session}.rs`、`bin/ec-engine.rs` 与对应 tests。
  - `Error` 改为命名结构，携带稳定 `ErrorKind` 与 `code()`；保留 `Error("...")` 旧构造语法，避免一次性机械重写。
  - 首批 kind：credentials、configuration、authentication、unsupported/unavailable capability、gateway HTTP、transport、data plane/transient、lifecycle、I/O、serialization 等。
  - lower-level 已分类 kind 不被上层覆盖；未分类错误可在 provider boundary 补充 domain kind。
  - Data Plane 的现有 transient string heuristic 被收束到 adapter boundary，离开该边界前转成 `DataPlaneTransient`。
  - auth configuration failure 现在稳定映射 `CONFIGURATION_INVALID`；unsupported MFA 继续映射 `UNSUPPORTED_AUTHENTICATION`。

### 新增或修改的测试

- CLI credential：稳定复用、端口迁移、0600、link count、symlink/hardlink/shared-mode fail-closed、无 secret output、root wrapper strict contract。
- Rust module boundaries：Engine 不依赖 probe；gateway HTTP 不依赖 transport/proxy/watch；credential input 不依赖 gateway/protocol。
- Typed errors：旧构造兼容、kind/code、I/O/serialization kind、provider kind preserve、data-plane transient、auth configuration event mapping。
- 原有 Gateway HTTP origin binding、HTTPS、user-agent、cookie/response bounds 迁移后继续测试。

### 执行的测试命令及结果

| 命令/门 | 结果 |
| --- | --- |
| `npm test` | 422 passed / 0 failed |
| `npm run check:architecture` | 151 JS files、195 edges、0 cycles；growth caps 通过 |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| 全套 Electron E2E | 全通过 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo clippy --locked --all-targets -- -D warnings` | 通过 |
| `cargo test --locked` | 189 passed / 0 failed / 2 ignored |
| release SOCKS matrix | 18/18，最大 p95 1.546 ms，pass |
| release netstack matrix | 27/27，最大 p95 6.080 ms，pass |
| release Engine/helper build | 通过 |
| macOS arm64 package、signature、Resources、app.asar/native string contract | 全通过 |

### 安全与兼容性影响

- Desktop 新安装与根 CLI 现在都默认要求本地代理认证；显式 Desktop compatibility mode 仍保留原 NO_AUTH/UDP 行为。
- CLI sidecar 只包含随机本地代理 secret，不包含 Gateway password/cookie/token；无效或不安全的既有文件不会被静默覆盖。
- Gateway HTTP 请求、cookie jar、redirect/HTTPS/response bounds、logout 和 Modern/Data Plane wire 行为未修改。
- `probe::read_credentials` 与 `watch::endpoint_url` 继续 re-export，减少内部工具 API 破坏。

### 尚未解决的问题与下一阶段

- `AuthenticatedGatewaySession` 仍持有 transport-specific `ModernSessionId`；下一步需分成 authenticated HTTP context 与 transport bootstrap input。
- 许多旧协议模块仍产生 `Unclassified` Error，且 `Error` 尚未保留 source chain；应按模块边界渐进分类，不全仓替换消息。
- `desktop/main.js`/Renderer 仍是 God Module；Phase 1 的 size gate 只阻止继续恶化，尚未完成 composition-root 目标。
- Gateway MFA transaction、pre-auth control、fake gateway 和 generic challenge UI 仍未实现；这些是下一阶段主线。

## 10. Phase 3：通用认证 Transaction 与安全控制协议基础

### 已验证的问题

1. `AuthenticatedGatewaySession` 使用 `modern_session: ModernSessionId` 命名/类型，认证结果仍直接拥有 transport-specific 类型。
2. Control v2 虽使用 inherited private pipe，但 Desktop 仅在 `listener_ready` 后握手，Rust 也只在完整 L3/listener 后输出 response；无法作为未来 challenge 前置协调基础。
3. 现有 `AuthOutcome::ChallengeRequired` 没有 transaction ownership、generation/epoch/request 绑定、secret type、resend/cancel/expiry 约束或 fake provider。

### 核心设计变化

- `independent/src/gateway_auth.rs`：新增 transport-neutral `AuthenticatedSessionId`，负责当前已验证 password-login `TwfID` 的 bounded parse、redacted Debug 和 Drop zeroize。`AuthenticatedGatewaySession` 字段改为中性 `session_identifier`；Modern adapter 只消费该值。旧 `ModernSessionId` 保留为兼容 type alias。
- `independent/src/engine/auth_transaction.rs`：
  - `AuthProgress<Session, Transaction>` 作为认证完成/挑战二选一结果；旧 `AuthOutcome` 是兼容 alias。
  - `ChallengeView` 只含 Engine correlation ID、epoch、generic kind、可选 delivery/masked destination/expiry/resend/attempt metadata。
  - `SecretBytes` 仅限制最大 4096 bytes，不假设 OTP 长度、字符集或渠道，Debug 永远 redacted，Drop 自动 zeroize。
  - `AuthTransactionOwner` 强制 `generation + transactionId + challengeEpoch + requestId`，bounded request dedupe；resend 必须生成更高 epoch；Unknown challenge 不可 respond/resend，只可 cancel/abort。
  - expiry、cancel、process/internal abort 均清理 pending transaction；provider 返回不一致 view 时 transaction 立即失效。
- `independent/src/engine/auth_control.rs`：新增独立 secret-bearing Control API v3 codec/session，不改变 v2 secret-free contract。
  - raw input buffer、chunk、response String 均 zeroize；parser error 不回显 frame。
  - respond/resend/cancel request 有固定上限和严格 schema；response/event 只序列化 sanitized `ChallengeView` 或稳定 error code。
  - 不打开 TCP/loopback listener，不包含 vendor endpoint、form、TwfID/CSRF wire 字段或固定验证码形状。
  - Production password-only provider 暂不广告/链接 v3；待真实 interactive provider 和 Desktop UI wiring 后才启用。
- pre-auth Control v2：Desktop 在写入 credential prefix 后立即握手；Rust 在调用 password provider 前 bounded 等待并返回首个 control exchange。v2 仍为 password-only provider 的 optional graceful-control contract。

### Fake provider 与测试矩阵

- `independent/tests/fake_auth_transaction.rs` 覆盖：
  - password-only 直接 authenticated，不构造 transaction；
  - OTP synthetic challenge、错误/正确 response；
  - generation/transaction/epoch/request binding；
  - duplicate request、resend epoch/cooldown、cancel；
  - expiry 后 fail-closed 并清理；
  - Unknown challenge 不能被提交；
  - pending secret-bearing transaction Drop/abort 证据。
- `auth_control` unit tests 覆盖 secret frame Debug/redaction、sanitized event/response、stale/duplicate/resend stable errors。
- module boundary gate 证明 generic transaction/control 不含 vendor endpoint、`svpn_*`、`NextService`、固定 OTP shape 或网络 listener。
- Engine integration 证明 `control_hello` 在 auth configuration failure 之前返回；Desktop source contract 证明 handshake 不再等待 listener。

### 验证结果

| 命令/门 | 结果 |
| --- | --- |
| `npm test` | 422 passed / 0 failed |
| Desktop architecture/audit/Electron E2E | 全通过 |
| Rust fmt/clippy | 通过，0 warnings |
| `cargo test --locked` | 204 passed / 0 failed / 2 ignored |
| release SOCKS matrix | 18/18，最大 p95 1.302 ms，pass |
| release netstack matrix | 27/27，最大 p95 6.074 ms，pass |
| release Engine/helper build | 通过 |
| macOS arm64 package/Resources/signature | 通过 |

一次附加的 `strings` 检查因期望未启用的 v3 字符串出现在 password-only release binary 而返回 1；该假设与“未广告/未链接 v3”的安全边界冲突，因此不作为 package failure。随后 authoritative package verifier 与 codesign 均通过。

### 安全与兼容性影响

- password-only production path 不经过 challenge UI/transaction loop，外部行为和 Data Plane 顺序保持。
- Renderer 仍不接触 cookie、TwfID、CSRF、Modern token、transport token 或原始响应。
- v3 只是一套已测试但未启用的 Engine-internal/control contract，不会制造“学校 MFA 已支持”的错误声明。
- Control v2 wire schema/capability 保持原样，只把握手响应前移；无控制客户端的 CLI 不传该 flag，行为不变。

### 尚未完成与下一阶段

- 需要把 v2/v3 multiplexing 和 `AuthControlSession` 真正接入 ec-engine 的 challenge loop；只有 provider 宣布 interactive capability 时才允许/要求 v3。
- Desktop 需要独立 auth-challenge coordinator、preload IPC 和 generic UI；OTP submit/cancel 后需同步清空 DOM/Main/Rust copy。
- 需要把 fake transaction 扩展为 fake Gateway HTTP fault harness，覆盖 partial cookie/logout/network loss/L3-after-challenge failure。
- `desktop/main.js` 与 Renderer 仍需按 coordinator/feature 渐进拆分，最终达到 composition-root 标准。

## 11. Phase 3 completion：v2/v3 Multiplexing、Desktop Challenge Flow 与 Synthetic Engine

### 已验证的问题

1. `ec-engine` 的 inherited stdin reader 只接受 Control v2；已存在的 v3 codec 无法与 credential prefix/v2 在生产 assembler 中共存。
2. Desktop 只有 secret-free `EngineControlClient`；Main/Preload/Renderer 没有 challenge ownership、窄 IPC 或通用交互 UI。
3. `AuthTransactionOwner` 在 active owner 被 Drop 或 provider 返回非法 view 时不保证调用 `cancel()`；public expiry/resend timestamp 也没有 Engine-side defense-in-depth gate。
4. 只有同进程 fake transaction；没有真实子进程 pipe 证明 Rust v3 与 Desktop schema 可互操作。

### 修改范围与核心设计

- Rust inherited control：
  - `independent/src/engine/control_mux.rs` 以一个 bounded、zeroizing reader 有序区分 v2/v3；v2 schema/capability/action 保持不变。
  - `independent/src/bin/ec-engine.rs` 在 pre-auth 和 connected control loop 中消费 multiplexed frame。当前 password-only provider 没有 transaction，因此任何 unsolicited v3 request 只返回稳定 `transaction_closed`，不会进入 Gateway、Transport 或 Data Plane。
  - v3 先于 v2 hello 到达时，Engine 返回 fixed error 后仍在同一 2 秒 deadline 内等待 v2，避免破坏现有 Desktop handshake。
- Transaction lifecycle：
  - active `AuthTransactionOwner` Drop 和非法 provider transition 均调用 provider `cancel()`；authenticated transition 不调用 cancel。
  - `expiresAtUnixMs` 与 `resendAfterUnixMs` 在 owner 内以可注入时钟再次检查；过期/cooldown 在 provider call 前 fail-closed。过期后 cancel 仍允许，避免 deadline 阻塞 cleanup。
- Non-shipped synthetic Engine：
  - `independent/src/bin/ec-auth-fixture.rs` 不访问网络、不含 vendor endpoint，只表达 synthetic password → OTP challenge → response/resend/cancel → authenticated。
  - release workflow 仍只构建/复制 `ec-engine` 与 `ec-proxy-command`；package filter 和最终 Resources 检查均排除 fixture。
- Desktop：
  - `desktop/lib/engine-auth-control-client.js` 严格解析 sanitized v3 event/response；所有 command 绑定 Main-owned generation/transaction/epoch/request。Response frame 在 write callback 后清零；timeout 关闭 inherited pipe 并清理 pending challenge。
  - `desktop/lib/auth-challenge-coordinator.js` 是唯一 Main challenge owner。Renderer view 删除 transaction ID、epoch 和 generation，只保留 kind、masked delivery、expiry/resend/attempt display metadata。
  - `desktop/lib/engine-control-suite.js` 组合独立 v2/v3 client 并管理 generation lifecycle；`main.js` 只 bind/feed/clear registry。
  - Preload 只公开 `respondAuthChallenge`、`resendAuthChallenge`、`cancelAuthChallenge` 与 sanitized event；没有 raw IPC、cookie/session/token getter。
  - `desktop/renderer/auth-challenge.js` 独立于 1165 行 `renderer/app.js`。输入使用 `autocomplete="one-time-code"`，但不限定 numeric、长度或 delivery channel；Unknown challenge 只能 cancel。DOM 在 IPC 前清空，失败不回填 response。
  - JavaScript immutable string 无法提供强 zeroize 保证；实现以 byte bounds、立即清 DOM/引用、禁止 persistence/log/error echo 缩短生命周期，Rust `SecretBytes`/raw frame 提供可执行 zeroization boundary。
- CI：新增 Rust child-process fixture、Node/Rust cross-language pipe gate；architecture baseline ratchet 到 `main.js=2341`，直接依赖仍为 44，`renderer/app.js=1165`，0 cycles。

### 新增或修改的测试

- Rust：mux mixed-order/malformed frame、production v3 fail-closed、owner Drop/invalid transition cleanup、Engine-side expiry/cooldown、synthetic child process accepted 与 wrong→resend→cancel。
- Desktop：v3 parser strictness、secret frame clearing、timeout pipe close、coordinator stale generation/duplicate/cooldown/expiry、Renderer DOM clearing/unknown fail-closed、Preload narrow surface、v2/v3 suite coexistence。
- Cross-language：真实 `ec-auth-fixture` 子进程由 `EngineControlSuite`/Main coordinator 驱动，覆盖 wrong response、resend、accepted response；stdout 不含 response 或 synthetic secret。

### 验证命令与结果

| 命令/门 | 结果 |
| --- | --- |
| `npm test` | 439 passed / 0 failed |
| `npm run check:architecture` | 160 JS files / 204 edges / 0 cycles；main deps 44；main 2341；renderer app 1165 |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `npm run test:auth-control-e2e` | PASS，真实 Rust child process + Desktop v2/v3 clients |
| Rust fmt + `cargo clippy --locked --all-targets -- -D warnings` | 通过，0 warnings |
| `cargo test --locked` | 212 passed / 0 failed / 2 explicitly ignored performance tests |
| release SOCKS matrix | 18/18，最大 p95 1.259 ms，pass |
| release netstack matrix | 27/27，最大 p95 6.383 ms，pass |
| 全套 Electron main/browser/MFA/strict/layout/soak/restart/idle | 全通过 |
| latest macOS arm64 dir package verifier | `signature=apple`，v1.2.2，pass |
| `codesign --verify --deep --strict` | valid on disk / satisfies Designated Requirement |
| app.asar + Resources inspection | 四个 Desktop auth module 已打包；`ec-auth-fixture` 不在包内 |

本机没有 notarization credentials/options，electron-builder 明确报告跳过 notarization；这次结果不是 notarized production-release 证明。两个附加 raw `cmp` 探索检查返回 1，因为 codesign 会修改 Mach-O signature/load-command 布局，即使移除签名也不保证恢复原始字节；它们不是有效 package gate，authoritative 结果是 build ordering、architecture、package verifier 和 codesign verification。

### 安全与兼容性影响

- Password-only production provider、Gateway HTTP、Modern L3、special TLS、netstack、DNS 和 proxy frontend 行为未修改；v3 transport 可解析不等于学校 MFA 已支持。
- Renderer 不持有 Gateway cookie、TwfID、CSRF、Modern/transport token、transaction ID、epoch、generation 或原始 auth response。
- Unknown/unsolicited/stale/duplicate/expired/cooldown/auth-control-timeout 全部 fail-closed；cancel/Drop 仍能执行 cleanup。
- v2 hello/shutdown/cancel/close wire contract 与 signal fallback 完整回归；关闭 control stdin 仍不等价于普通 password-only tunnel shutdown。

### 尚未解决与下一阶段

- 没有学校真实 MFA endpoint/字段/流程证据，因此没有 production interactive provider，也不宣告 Gateway MFA 可用。
- 仍需基于脱敏授权证据构建 fake Gateway HTTP fault harness，覆盖 partial cookie、CSRF/continuation cleanup、network loss、restart、logout failure 与 challenge 后 L3 failure；在此之前不得改写真实 Gateway MFA 协议。
- `desktop/main.js` 仍有 2341 行，虽 auth lifecycle 已移出且 growth gate ratchet，但尚未达到“主要作为 composition root”的最终标准；下一安全批次应提取现有 Engine connection orchestration 或 IPC domain registration，保持外部行为不变。
- `renderer/app.js` 仍有 1165 行；auth feature 未继续扩大它，但其他 routing/certificate/resource features 仍需按测试覆盖渐进拆分。
- GitHub main branch protection、checksum/SBOM、正式 notarization/Windows signing 属于仓库外或 release-supply-chain 工作，当前仍未解决。

## 12. Desktop composition-root 收敛与协议中立 Fault Harness

### 已验证的问题

1. `desktop/main.js` 仍直接创建 `EngineEventParser`/`EngineProtocolSession`、解释每种 Rust event、管理 hello timer 并同时喂 v2/v3 control；Rust wire ownership 仍泄漏到 composition root。
2. routing rules、certificate pins、campus resources 的 IPC validation/CRUD/rollback 共约 150 行仍在 Main；新增 feature 会继续扩大 God Module。
3. Engine `exit` 发生后、stdio `close` 前仍可能 drain 尾部 stdout；若 runtime/control client 未同步关闭，已清理的 challenge 可能在废弃 client 对象内被重新解析。
4. CI 的 syntax step 仍手工列举入口，新增加的 feature 文件可能不经 `node --check`。
5. Fake transaction 已覆盖 state machine，但没有证据说明 opaque partial cookie/CSRF/continuation state 在 restart、terminal network loss、challenge 后 L3 failure 时仍由 Rust 清理。

### 修改文件与核心设计

- `desktop/lib/engine-connection-runtime.js`：
  - 唯一拥有 `EngineEventParser`、`EngineProtocolSession`、Event hello deadline 与共享 stdout feed；
  - 构造时 generation-bound bind control registry，credential prefix 写入后立即 `start()` v2 handshake；
  - 向 Main 只回调 connecting、connection candidate、listener ready/mismatch、DNS、health、fatal、timeout 等 typed facts；
  - `dispose()` 同步取消 timer、移除 stdout listener、清 parser；process `exit` 先 dispose，再执行原 browser request gate/control/proxy cleanup。
- `desktop/lib/routing-rule-ipc.js`、`certificate-pin-ipc.js`、`campus-resource-ipc.js`：每个 feature 只拥有 exact-key IPC validation 与注入的 store/transaction；不访问 Electron window、Engine、credentials、Browser 或 transport。
- `desktop/lib/control-data-ipc.js`：单一 façade 供 Main composition；Main 不直接依赖三个 feature implementation。
- `desktop/main.js`：保留 credential final snapshot、spawn、proxy credential、connection state、Campus Browser resume 与 UI mutation；删除 Rust parser/schema 和三组 CRUD 业务实现。
- `desktop/build/verify-package.js`：沿 Main → façade → resource handler 新拓扑验证，并要求 runtime、auth、routing/certificate/resource IPC modules 全部存在于 asar。
- `.github/workflows/ci.yml` / `build.yml`：`rg --files` 遍历全部项目 JS 执行 syntax check，不再维护易遗漏的手工列表。
- `independent/tests/fake_gateway_faults.rs`：test-only、无 endpoint、无网络的 opaque-state harness。Synthetic cookie/CSRF/continuation 用 `Zeroizing<Vec<u8>>` 留在 transaction；public event/Debug 不含其值或字段。

### 新增或修改的测试

- `desktop/test/engine-connection-runtime.test.js`：generation bind、pre-readiness handshake、typed dispatch、listener mismatch、stale output、hello timeout、dispose/remove listener。
- `desktop/test/control-data-ipc.test.js`：精确 channel topology、routing/certificate identity validation、resource transactional CRUD、unknown-field fail-closed。
- auth/control client tests：close 后尾部 stdout 不可复活 challenge。
- package verifier tests：新 composition topology 与 synthetic fixture 排除。
- `fake_gateway_faults.rs`：opaque state 不出 Engine；restart/drop/cancel cleanup；provider 明确 terminal network loss 关闭 transaction；challenge authenticated 后 synthetic L3 failure logout completed session。

### 验证结果

| 命令/门 | 结果 |
| --- | --- |
| `npm test` | 446 passed / 0 failed |
| Architecture gate | 167 JS / 214 edges / 0 cycles；main deps 43；main 2145；renderer app 1165 |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| 全项目 JS syntax + workflow YAML parse | 通过 |
| Rust fmt + Clippy `-D warnings` | 通过，0 warnings |
| `cargo test --locked` | 215 passed / 0 failed / 2 ignored performance gates |
| Rust/Desktop cross-language auth fixture | PASS |
| Electron main/toolbar/MFA/strict/layout/20-tab soak/restart/idle | 全通过 |
| release SOCKS matrix | 18/18；最大 p95 1.196 ms |
| release netstack matrix | 27/27；最大 p95 6.087 ms |
| latest macOS arm64 package verifier + `codesign --deep --strict` | Apple Development signature，pass |
| asar current-source comparison | `main.js`、Engine runtime、control-data façade 与工作树一致；fixture 不在包内 |

### 安全与兼容性影响

- `main.js` 从上一 ratchet 2341 行降到 2145（-196），直接依赖 44→43；新的 baseline 已下调，后续不能反弹。
- Credential final snapshot 到 spawn/stdin 的同步无 `await` 区间不变；password-only、v2 handshake、signal fallback、listener gate 与 reconnect policy 完整回归。
- 合法 routing/certificate/resource IPC 结果与 rollback 顺序保持；未知字段从“被 helper 忽略”收紧为显式拒绝。
- Production Rust、Gateway HTTP、Modern L3、special TLS、DNS、SOCKS/HTTP forwarding 未因 fault harness 修改。
- In-memory harness 不证明真实 HTTP cookie jar、学校 MFA endpoint 或 server cleanup；它只证明 generic ownership/failure contract。

### 尚未解决与下一阶段

- `desktop/main.js` 仍有 2145 行；settings/credential mutation IPC、window/tray/browser composition 仍应分批提取，尚未达到最终 composition-root 标准。
- `renderer/app.js` 仍有 1165 行；routing/certificate/resource UI 仍在同一文件。
- 尚无 synthetic HTTP Gateway/provider adapter；下一步若实现，endpoint 必须明确为 fixture-only，不能推导学校路径、字段或验证码规则。
- 真实学校 Gateway MFA provider、正式 notarization/Windows signing、branch protection、checksum/SBOM 仍未完成。

## 13. Settings/Credential Controller 与 Renderer Feature 拆分

### 已验证的问题

1. Main 的 `save`/`logout` IPC 同时承担 exact schema、settings patch、policy queue rebase、credential journal、recovery message、locale/login-item side effects 和 reconnect，约 200 行安全敏感业务仍在 composition root。
2. `renderer/app.js` 的 resource editor、routing rules 和 certificate pins 各自拥有 state/timer/CRUD/HTML escaping，但仍共享同一 1165 行脚本；feature 间可因全局变量或 locale 重绘互相影响。
3. Package verifier 仍在 monolith 中寻找 URL naming/save handler 字符串，无法证明拆分后的 feature 文件和加载拓扑已打包。

### 修改文件与核心设计

- `desktop/lib/settings-credential-ipc.js`：
  - exact-key/bounded settings IPC schema；
  - 保留 password + network policy 组合请求拒绝；
  - policy transaction 内重新读取 latest settings，保留最新 resource mutation；
  - username change 仍要求同一 transaction 内的新 password；
  - 调用既有 `runCredentialSettingsMutation`，不复制 journal/rollback implementation；
  - recovery status 仍决定 stable user message 与 `rollbackIncomplete`；
  - save/logout 每条返回路径 best-effort 清空 parsed patch 和 Main IPC payload 的 password 引用；
  - locale、login item、Engine reconnect/stop 以 injected effects 执行，module 不依赖 Electron 或 Rust。
- `desktop/lib/control-ipc-suite.js`：Main 的单一 control IPC composition import；各 data/settings feature implementation 仍独立。
- Renderer：
  - `manager-view.js` 集中 escaping、bounded error、collection/time formatting；
  - `routing-manager.js`、`certificate-manager.js`、`resource-manager.js` 各自拥有 DOM、timer、busy/delete-confirm 与窄 Preload CRUD；
  - `app.js` 只注入 resource collection/save callback，并以 value-free `app-locale-changed` 通知 feature 重绘；
  - `index.html` 明确在 `app.js` 前加载 manager helpers/features。
- Package verifier：要求 settings/controller IPC suite 与三个 manager 存在，验证 script ordering，并沿 app → resource manager、Main → IPC façade 拓扑检查。

### 新增或修改的测试

- `settings-credential-ipc.test.js`：exact schema、credential transaction、password reference clear、combined request rejection、policy rebase、locale/login item、username-without-password、recovery failure、logout 与 blocked recovery。
- `renderer-manager-features.test.js`：escaping/bounded errors、host normalization、untrusted field projection、certificate display DTO。
- `resource-manager-feature.test.js`：HTTP(S)-only name suggestion、escaped editor markup、two-click delete、CRUD wiring。
- Existing renderer policy/package tests 改为读取 feature ownership，而不是在 `app.js` 搜索旧实现。

### 真实回归中发现并修复

第一次 `test:renderer-layout` 发现 quick-add 保存后 hidden `resourceEditorList` 未刷新。持久化与 open request 已成功，但旧 observable DOM behavior 被提取遗漏。App 现在保留 manager composition reference，每次 `saveCampusResource` 后调用 `renderList()`；失败用例和全套 Electron 随后均通过。

### 验证结果

| 命令/门 | 结果 |
| --- | --- |
| `npm test` | 459 passed / 0 failed |
| Architecture gate | 176 JS / 226 edges / 0 cycles；main deps 43；main 1940；renderer app 558 |
| 全项目 JS syntax + workflow YAML | 通过 |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| Rust fmt/Clippy/full tests | 215 passed / 0 failed / 2 ignored；0 warnings |
| Rust/Desktop auth fixture | PASS |
| Electron main/layout/toolbar/MFA/strict/20-tab/restart/idle | 全通过 |
| latest macOS arm64 verifier + deep codesign | Apple Development signature，pass |
| final asar comparison | Main、Renderer shell、settings controller、routing/certificate/resource managers 与工作树一致；fixture 不在包内 |

一次 electron-builder 生成过程在下载后无 CPU/子进程/文件进展，约 5 分钟后只中断该可重建 process；未删除源码、target 或既有 app。第二次相同命令正常完成并通过全部 verifier，因此只有第二次产物作为证据。

### 安全与兼容性影响

- Main 从 2145 行降至 1940；Renderer shell 从 1165 行降至 558；direct Main deps 保持 43。Architecture baseline 已同步 ratchet。
- 既有 credential journal、fsync/rename、recovery block、username/password pairing、policy rollback、reconnect 顺序均完整回归。
- 合法 UI/IPC 行为保持；Manager dynamic values 继续 escape，certificate view 只含 origin/fingerprint/time。
- Renderer features 不接触 Rust schema、Gateway state、password/OTP、Engine token 或 persistence implementation。
- Production Rust、Gateway/Modern/Data Plane/DNS/proxy wire 本批未修改。

### 尚未解决与下一阶段

- `main.js` 仍有 1940 行：browser composition、window/tray/menu、read-only/core IPC 和 connectivity presentation 尚未全部提取，最终 composition-root 标准仍未满足。
- Renderer shell 仍拥有 login/connect/tower/update/log UI；虽已显著缩小，仍需完成 requirement-by-requirement completion audit。
- 尚无 synthetic HTTP Gateway/provider adapter；真实学校 MFA 继续 fail-closed unsupported。
- 正式 notarization/Windows signing、branch protection、checksum/SBOM 仍未完成。

## 14. Desktop Composition Root 最终收敛与完成审计

> 2026-08-23 更正：本节记录当时一轮实现快照，但其中“最终”“达成”的措辞过强。独立复核后的第 15 节为更新结论：Main 只是显著接近 composition root，CI 也仍需远端三平台与 release governance 证明；仓库总体尚未达到正式合并/发布完成状态。

### 已验证并修改的问题

1. Window/tray/menu/close/quit 仍共享 Main 全局 `win/tray/isQuitting/quitAllowed`，并把 navigation hardening 与 credential cleanup 混在应用入口。
2. Campus Browser/Vault construction、open normalization/route/error mapping 与 Main 状态直接耦合。
3. Main 直接依赖 process enumeration、TCP latency socket、SOCKS health probe、failure evidence budget 与 telemetry timers，Network policy 未形成独立 boundary。
4. Core IPC channel validation 分散在 Main；source-contract tests 因 ownership 移动仍寻找旧 `trustedHandle` 字符串。
5. CI 有 runtime redaction tests，但没有显式拒绝 tracked private-key/cloud-token shape 的 gate。

### 核心设计变化

- `desktop/lib/desktop-shell.js`：唯一拥有 control window、tray/menu、close prompt、resize、quit state 与 ordered cleanup；control window 保持 sandbox/contextIsolation/no-Node、拒绝 popup/navigation/webview。
- `desktop/lib/campus-browser-manager.js`：唯一创建 Campus Browser 与 encrypted Vault；拥有 open normalize/route/ensure-connected/result mapping，并以 wrappers 暴露 suspend/resume/close/certificate/locale。
- `desktop/lib/connection-telemetry-coordinator.js`：拥有 process enumeration、latency socket、concurrent tunnel probes、three-failure recovery evidence、generation binding 与 TelemetryService。
- `desktop/lib/core-control-ipc.js`：集中 get-state/connect/log/browser/update/external/resize 等 exact/bounded IPC schema；Main 只注入 operations。
- `desktop/scripts/check-sensitive-patterns.js`：扫描 Git tracked、≤2 MiB、非二进制文本，阻止常见 private key、GitHub/AWS/Slack/OpenAI token shape；synthetic test vocabulary不误报。
- `desktop/main.js`：当前主要职责为 path/state 初始化、依赖装配、Engine connection lifecycle、PAC transaction 与 Electron app event composition。

### 新增测试与回归

- DesktopShell：window security、tray action、close/remember、single-flight quit cleanup。
- CampusBrowserManager：single instance/Vault injection、route/connection/browser errors、lifecycle/certificate wrappers。
- ConnectionTelemetryCoordinator：generation bind、healthy reset、three-failure reconnect、disabled/stale suppression。
- CoreControlIpc：exact channels、Campus request schema、copy/update/external/resize rejection。
- Secret gate：动态构造 representative credentials，避免测试源码自命中；tracked tree gate PASS。
- 所有旧 source contracts 更新为验证新 ownership，而非保留 dead marker。

### 最终验证快照

| 门 | 最终结果 |
| --- | --- |
| Desktop unit | 474 passed / 0 failed |
| Rust full | 215 passed / 0 failed / 2 explicit performance ignores |
| Clippy | 0 warnings |
| Architecture | 186 JS / 235 edges / 0 cycles；Main deps 35；Main 1596；Renderer 558 |
| Secret gate / npm audit / all JS syntax / YAML | PASS / 0 vulnerabilities / PASS / PASS |
| Rust/Desktop synthetic auth E2E | PASS |
| Electron main/toolbar/MFA/strict/layout/20-tab/restart/idle | 全通过 |
| release SOCKS/netstack matrices | 18/18（max p95 1.196 ms）/ 27/27（6.087 ms） |
| latest macOS arm64 package + deep codesign | Apple Development signature，pass；未 notarize |
| final asar comparison | Main、Shell、Browser/Telemetry/Core IPC managers 与工作树一致；fixture 不在包内 |

### 最终完成标准逐项结论

| 标准 | 证据与结论 |
| --- | --- |
| Main 主要为 composition root | 从审计初始 2342 行/44 deps 降到 1596/35；auth/settings/CRUD/window/browser/telemetry/core IPC 均独立，Main 剩 path/state assembly、Engine lifecycle、PAC/app events。达成。 |
| Desktop UI 不依赖 Rust 协议细节 | Renderer 只消费 generic challenge/display DTO 与窄 Preload API；Event/control parsing 在 Main-side runtime/client。达成。 |
| Authentication 产生 Session 或 Challenge | `AuthProgress<Session, Challenge>`、`AuthenticatedGatewaySession`、Engine-owned `AuthTransactionOwner`/Control v3 有实现与 synthetic E2E。达成。 |
| Transport 只消费认证完成 session | `ModernL3TransportBackend::connect_or_logout(AuthenticatedGatewaySession)`；challenge 后 L3 failure logout fault test。达成。 |
| DNS/SOCKS/HTTP 不反向依赖 auth | 当前 production modules 无 auth/gateway import；module boundary tests、destination policy/frontends完整回归。达成。 |
| 新增 MFA 不需改 Data Plane | Generic transaction/control/Desktop flow 在未改 special TLS、Modern Data Plane、netstack、DNS/proxy wire 下完成。达成。 |
| Password-only 完整回归 | Production provider仍只 advertise password/L3；Desktop/Rust/Electron/performance/package全通过。达成。 |
| Unknown/unsupported fail-closed | Provider capabilities、Unknown challenge、unsolicited/stale/duplicate/expired/cooldown/timeout tests均拒绝。达成。 |
| CI 阻止 God Module/cycle/secret回归 | Ratcheted Main/Renderer/dependency budgets、cycle graph、all-JS syntax、tracked secret gate、redaction/DTO/module-boundary tests均在 CI/build workflow。达成。 |

### 明确不属于当前完成声明

- 未实现或宣告学校真实 Gateway MFA provider；需要未来授权、脱敏证据后进入 Phase 4。
- 本机包为 Apple Development 签名且未 notarize；Windows production signing、branch protection、checksum/SBOM 仍是 release/external governance 后续，不影响本次代码边界完成结论。

## 15. 独立复核整改：Windows CI、旧用户代理迁移与 popup MFA

日期：2026-08-23。输入为完成审计后的独立复核意见；所有判断重新对照当前工作树，不把意见或 code comment 直接当作事实。

### 已验证的问题

1. `.github/workflows/build.yml` 的 `Test desktop shell` 为三平台共用 step，包含 Bash loop、process substitution 与 `bash -n`，但未指定 shell；Windows 默认 PowerShell 会在执行测试前解析失败。成立，发布阻断。
2. Version 2 settings 的 `strictProxyAuth=false` 被兼容保留；这避免静默破坏既有 Clash/SSH，但用户没有一次明确迁移决策，继承的 NO_AUTH 可长期无提示保留。成立，F-03 仅部分关闭。
3. Campus Browser popup 被转为新 tab，而 password candidate 只归原 tab；新 tab 的 challenge 不能阻止原 tab 根据旧的无表单页面独立得出成功。成立。现有 Electron MFA E2E 只使用单个 BrowserWindow，不能作为 popup/跨 origin/SameSite 证据。
4. Production provider 仍为 `NoAuthChallenge`，生产 Engine 不运行真实 provider transaction。成立且属于有意边界；缺少学校脱敏协议证据时不修改。

### 修改文件与核心设计

- `.github/workflows/build.yml`：跨平台 Desktop test step 显式 `shell: bash`；新增真实 Electron popup MFA gate。
- `desktop/test/release-assets.test.js`：锁定 Bash-only step 必须显式选择 Bash，避免 Windows workflow 回归。
- Settings migration：
  - `settings-store.js` 把 v2 inherited compatibility 规范化为 `strictProxyAuth=false` + `proxyAuthMigrationPending=true`；新安装、已明确 strict、已明确当前兼容选择均不产生提示。
  - `settings-update.js` / `settings-credential-ipc.js` 只接受 renderer 的 value-free-style explicit acknowledgement `proxyAuthMigrationAcknowledged: true`；任一 strict switch 决策也清除 pending。
  - “继续兼容”只清除提示，不重启 Engine；“启用认证”沿既有 policy transaction 保存并按需重连。
- Renderer：
  - `proxy-auth-migration.js` 独立拥有提示、busy state、启用/继续兼容和失败恢复；`app.js` 只注入 settings getter/setter、translation、flash 与 tower busy 状态。
  - 迁移 UI 不显示或接收 SOCKS credential；中英文明确说明 inherited compatibility 风险与选择。
  - Architecture gate 首次阻止 `app.js` 从 558 增至 601；未抬高 baseline，而是提取 feature，最终 `app.js` 为 524 行。
- Campus popup credential flow：
  - `CredentialController` 在 Main 内维护 popup → owner 的 opaque ownership；password 仍只存在于一个 owner candidate，不复制到 popup tab、renderer 或 URL。
  - `setWindowOpenHandler` 在异步创建新 tab 前先 reserve flow，关闭原标签 racing success 窗口。
  - popup 和 opener 使用同一 persistent Electron Session；每个 tab 的 navigation evidence 独立，challenge observation 属于整个 flow。
  - opener 在 popup/reservation 活跃时不能确认成功；popup 必须先真实观察 generic challenge，随后才可用 post-challenge DOM/navigation evidence完成。
  - popup 关闭后，opener 的旧 waiting/blank document 无效，必须出现 challenge 之后的新 HTTPS navigation evidence。
  - popup 关闭只 unlink；owner/timeout/失败导航/route/crash/window teardown 继续统一 zeroize candidate。
- `campus-popup-mfa-safety.electron.js`：in-memory HTTPS synthetic SSO，覆盖跨 origin popup、共享 `SameSite=Lax; Secure` cookie、OTP 不被校园密码填充、opener 阻断与完成后 exact-origin 保存；无学校 endpoint、账号或真实 OTP。
- Package verifier 要求 `renderer/proxy-auth-migration.js` 存在且在 `app.js` 前加载，并拒绝任何 `/e2e/` 或 `/test/` 进入 asar。

### 新增或修改的测试

- Settings store/update/IPC：v2 pending、secure choice、explicit compatibility acknowledgement、invalid acknowledgement、no-op acknowledgement 不重连。
- Renderer feature：pending visibility、narrow save payload、failed switch restoration、入口 composition contract。
- CredentialController/CampusBrowser：deferred popup reservation、password single ownership、challenge blocks opener、popup completion、popup close后 stale opener evidence、shared Session。
- Electron：真实 WebContentsView popup → tab、跨 origin challenge、SameSite cookie、password/OTP isolation、credential prompt。
- Workflow/package：Windows Bash shell contract、新 feature packaging、全部 synthetic fixture exclusion。

### 验证结果

| 命令/门 | 结果 |
| --- | --- |
| `npm test` | 483 passed / 0 failed |
| Architecture gate | 189 JS / 238 edges / 0 cycles；Main deps 35；Main 1596；Renderer app 524 |
| Secret gate / `npm audit --audit-level=high` / all JS syntax / shell syntax | PASS / 0 vulnerabilities / PASS / PASS |
| Electron same-window MFA | PASS |
| Electron popup/cross-origin/SameSite MFA | PASS |
| Electron strict proxy / Main integration / renderer layout | PASS / PASS / PASS |
| Rust fmt + Clippy | PASS / 0 warnings |
| `cargo test --locked` | 215 passed / 0 failed / 2 explicit performance ignores |
| Rust/Desktop auth fixture | PASS |
| macOS arm64 package verifier | PASS；feature 在 asar，`e2e/`/`test/` 不在包内 |
| `codesign --verify --deep --strict` | PASS；Apple Development，未 notarize |

本地 `npm run dist:mac` 不是完整成功证据：配置会构建 arm64 + x64。arm64 App 已生成、签名并独立通过 verifier；随后 x64 按 package hook fail-closed，因为本地 `desktop/engine` 没有 CI 才会构建的 `ec-engine-darwin-amd64`。报错后的 electron-builder 已无子任务却未自行退出，因此只终止该已失败进程。没有复制 arm64 Engine 冒充 x64，也没有宣称双架构 DMG 成功。远端 workflow 会先从 Rust 分别构建两种架构，仍需实际远端 CI 证明。

### 安全与兼容性影响

- Windows build 的 shell 解析阻断已从代码层关闭，并有回归测试；尚未触发远端 Windows runner，因此不能声称真机/远端发布已验证。
- v2 用户不会被静默断开旧客户端，但继承兼容模式不再永久沉默；用户明确选择后才清除 pending。新安装继续 strict。
- Popup 关联只在 Main 内存中保存对象关系；不新增 credential IPC、transaction ID、cookie、OTP 或 token 暴露。
- Cross-origin SSO 继续使用既有 persistent Session，因此 cookie 行为不因复制/重建 Session 破坏。
- 没有修改 Production Rust、Gateway HTTP、Modern L3、special TLS、DNS、SOCKS/HTTP/UDP wire 或真实学校认证适配。

### 尚未解决与下一阶段

- Production Gateway MFA adapter 仍等待授权、脱敏证据；当前 v3 production request 保持 fail-closed `transaction_closed`。
- `desktop/main.js` 虽已从 2342 行降至 1596 行，仍拥有 Engine/PAC/connectivity/update/app-event 等较多 orchestration；应判定为“显著改善、部分达成”，不是严格 composition-only root。
- Rust `socks.rs` / `ec-engine.rs` 仍大，typed errors/liveness 仍为增量；Authentication/Transport 主边界成立不等于内部模块化全部完成。
- 认证阶段 Gateway HTTP timeout/异常响应仍可能归入 `AUTH_FAILED`；此前用户观察到的“正确密码被显示为密码错误”尚无真实故障证据证明根除，应另建 `auth_rejected` 与 `auth_indeterminate` 边界后回归。
- Electron synthetic E2E 证明 Chromium/Session/popup 机制，不证明学校 IdP 的真实 redirect、cookie attributes 或 SSO 返回页面；学校上线后仍需脱敏回归。
- 远端三平台 CI、Windows/Linux package、Windows signing、notarization、branch protection、checksum/SBOM 仍未完成。
- `socks.rs`/`ec-engine.rs` 体量、typed liveness、Windows DACL、certificate grant policy、HTTP fake gateway、JS formatter/coverage 等原审计残留没有在本批扩大范围。
