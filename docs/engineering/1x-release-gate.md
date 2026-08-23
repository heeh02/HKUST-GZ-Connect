# 1.x Architecture Frozen and Release Gate

状态：v1.2.3已正式发布；1.x Architecture Frozen仍为NO。勾选项只表示当前固定证据；
未勾选项继续作为工程证据边界，不得由“应该能工作”替代。

实现与package候选证据基线：`6efca3c2b762a9b2b47f74b11b965b2c126e5c91`；后续纯文档
提交不改变该实现树。若再修改production代码，必须重新固定SHA并重跑相应门禁。
正式交付commit为`5d8323d37de7c279ae70b3ec646f93791d6a3581`；它的production
实现与`6efca3c`一致，并包含后续发布策略与文档收口。`v1.2.3`精确指向该merge commit。
本轮产品版本仍为v1.2.3：新增内容属于补丁级稳定性、诊断、回归和交付门禁，不是新的
production Gateway能力。

本文件的v1.2.3发布勾选只冻结tag `5d8323d`的证据。post-release convergence commit
`a6d40691d6fb8fe18b4a2260ae6f5adea6b34a7c`中的startup recovery、UDP relay ownership、
connection waiter和quit gate不属于v1.2.3；其本地exact-tree gates、review以及PR #6
ordinary CI `32641232584`与compatibility offline run `32641232560`已通过，但在获得merge、
cross-platform package和单独版本决策以前不是新的发布候选。

## 1. Source and governance

- [x] 当前本地审计 HEAD和分支已记录。
- [x] 实现快照`6efca3c`的exact tree secret gate通过。
- [x] Review branch已push；PR #5包含候选实现提交，package run的source SHA与其一致。
- [x] PR #5包含全部候选改动，自动review意见已处理并resolve。
- [x] 最终维护者review完成，并已明确授权合并与发布v1.2.3。
- [x] PR #5以merge commit`5d8323d`进入`main`，merge tree与最终PR head一致。
- [x] main exact-commit CI run`32630023985`通过。
- [x] `v1.2.3`精确指向`5d8323d`；tag build/release run`32630322732`通过。
- [ ] `main` required checks和no-force-push branch rule已启用；final review与latest-commit
  main CI已由上方独立证据闭环。
- [x] 合并commit、tag、tag workflow和Release source SHA一致。

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
- [x] stale Engine close只清理旧generation内存凭据，不能删除新generation共享proxy sidecar。
- [x] listener/outer serving scope在logout前关闭并drain。
- [x] netstack/data-plane socket、runner和bridge thread有bounded shutdown/join。
- [x] 100次deterministic supervisor start/invalidate/stop/close无lifecycle residue。
- [x] 100次feature-gated真实`ec-engine` non-routing post-Transport start/stop：每轮child wait、test reader join、exact listener拒连并可重绑、递增generation输入，总deadline 120秒。
- [ ] 100次真实Gateway connect/stop/reconnect无PID、port、thread、timer增长。
- [ ] sleep/wake、offline/online、Wi-Fi切换通过真实设备canary。

## 4. Errors and diagnostics

- [x] Explicit reject、indeterminate、protocol invalid和cleanup secondary可区分。
- [x] 只有明确拒绝显示凭据未通过。
- [x] Worker/internal failure和legacy `AUTH_FAILED`不使用wrong-password文案。
- [x] Data Plane retry只读稳定kind，不搜索英文字符串。
- [x] Credential load区分missing/unavailable/corrupt/decrypt denied。
- [x] Connection、Browser、settings、recovery和log outcome分域。
- [x] Engine接受的结构化事件及fatal/stopped终态有stable code与`intent:generation`诊断关联，且不记录认证秘密。
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
- [ ] exact-SHA password-only登录、L3建立及至少一个校园HTTPS资源真实canary通过。
- [ ] exact-SHA Clash认证SOCKS与SSH `ProxyCommand`真实canary通过。
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
- [x] popup原生View/窗口竞态失败会事务回滚Tab、View与credential reservation，且不会
  形成Main未捕获异常。
- [ ] Campus site、Outlook/Canvas direct→SAML return真实canary。
- [x] 1.x Chromium `DIRECT` resolved-address限制已由ADR-0002正式接受；2.0 ControlledDirectExit负责消除。

## 8. Tests and static gates

- [x] Rust fmt通过。
- [x] Rust Clippy `-D warnings`通过。
- [x] 第一方Rust所有target以Cargo lint禁止`unsafe`代码。
- [x] Rust tests：当前收束树全量通过；精确数量记录在最终验证快照。
- [x] 本地macOS Desktop tests：530 total / 529 passed / 0 failed / 1 Windows-only skipped。
- [x] npm audit high：0 vulnerabilities。
- [x] Architecture/cycle gate通过。
- [x] 最终本地候选HEAD（含文档提交）的exact tree secret gate通过。
- [x] Main/MFA/popup/strict proxy/auth pipe E2E通过。
- [x] Desktop Main→synthetic Engine的retry/stale/listener/renderer-crash/stop/port-release场景通过。
- [x] feature-gated真实`ec-engine`子进程通过post-Transport netstack/listener/stop/join/port-release回归；不证明真实Gateway认证、Modern L3或校园转发。
- [ ] 30分钟persistent packaged Desktop/Browser RSS、FD/handle、task/thread净增长soak通过。
- [x] Windows runner的plaintext proxy helper sidecar current-user-only、inheritance-protected
  DACL test通过。
- [x] 候选SHA ordinary PR CI jobs全部绿色（runs `32628684472`、`32628684427`；
  live compatibility在PR场景按设计skip）。
- [x] merge commit `5d8323d`的main push CI run `32630023985`全部绿色。
- [ ] `main`已将相应jobs配置为required checks。

## 9. Package and platform

- [x] package verifier拒绝test/e2e/fake gateway/test PKI/private key pattern。
- [x] Native `engine/`目录使用exact platform manifest。
- [x] 所有官方production/package构建显式关闭test feature；`afterPack`在签名前拒绝fixture marker，独立verifier在打包后再次拒绝。
- [x] liblzma使用vendored static构建；macOS verifier对Engine与SSH helper执行system-only
  `otool -L`门，拒绝Homebrew、`/usr/local`及其他host-only dylib。
- [x] 所有electron-builder入口显式`--publish never`；唯一写权限publisher是tag-only
  release job，manual build没有隐式发布警告或上传尝试。
- [x] macOS arm64 clean package verifier和launch smoke。
- [x] macOS x64 clean package verifier和launch smoke。
- [x] Windows x64 NSIS/unpacked verifier和launch smoke。
- [x] Linux x64 AppImage/unpacked verifier和launch smoke。
- [x] macOS ad-hoc签名通过`codesign --verify --deep --strict`；这不等于Developer ID
  或notarization。
- [x] 三平台产物来自同一GitHub clean checkout/exact SHA `6efca3c`。
- [x] GitHub runner从clean checkout生成并上传，没有复用本地`desktop/release`。

### Fixed remote evidence

| Evidence | Result |
| --- | --- |
| PR | #5；implementation/package SHA `6efca3c2b762a9b2b47f74b11b965b2c126e5c91`；后续仅文档提交不冒充artifact source |
| Ordinary CI | `32628684472` |
| Compatibility CI | `32628684427` |
| Cross-platform package | `32628682638`，三平台jobs全部success，release job按manual场景skip |
| mac artifact | `9490520137`；artifact ZIP digest `sha256:989b3725a883069ead91c7294b9d13016679d8e72793576f182c784d9c370b64`；双架构adhoc/verifier/codesign/smoke通过 |
| Windows artifact | `9490498992`；artifact ZIP digest `sha256:7dc9243ae52dbb241af2175b427c51813db4382f2c60fc6c9ad0dd29988e32ec` |
| Linux artifact | `9490456479`；artifact ZIP digest `sha256:389e0183fd3ae1210ac0b48b4b42837ffb8996eb77b0dc13d8345673f19d961f` |

### Formal tagged release evidence

| Evidence | Result |
| --- | --- |
| Merge/source | `main` merge commit `5d8323d37de7c279ae70b3ec646f93791d6a3581` |
| Tag | annotated `v1.2.3` peels exactly to `5d8323d37de7c279ae70b3ec646f93791d6a3581` |
| Main CI | run `32630023985`；desktop、desktop-electron、Windows DACL、Engine全部success |
| Tag build/release | run `32630322732`；macOS、Windows、Linux和唯一release job全部success |
| macOS arm64 DMG | `hkustgzconnect-1.2.3-mac-arm64.dmg`；`sha256:0002cf90d1b49fe7a4d771e1fcad847b9d7883d82859de9273683660bcab269f` |
| macOS x64 DMG | `hkustgzconnect-1.2.3-mac-x64.dmg`；`sha256:4013d52bbc0644227af29aadc75530b3ba135e32578afb702fd724312b5c92dd` |
| Windows x64 EXE | `hkustgzconnect-1.2.3-win-x64.exe`；`sha256:e9068b5183239afcd38818617e4b6a51f17f883535933f19e362a8d5845760fa` |
| Linux x64 AppImage | `hkustgzconnect-1.2.3-linux-x86_64.AppImage`；`sha256:71dad3553d8e84fa97f5d86201f8075de6a7f8dc0a2bb74ff8e38fc1482e38a2` |
| Release | <https://github.com/heeh02/HKUST-GZ-Connect/releases/tag/v1.2.3>；published 2026-08-23 |

## 10. Documentation and capability truth

- [x] 根项目架构宪法存在。
- [x] 1.x audit、convergence plan和release gate存在。
- [x] Future Gateway MFA architecture明确generic与production差异；它不改变v1.2.3能力声明。
- [x] 2.0 vision、capability matrix、TUN ADR和ControlledDirectExit风险ADR存在。
- [x] `independent/ARCHITECTURE.md`与DNS TCP和shutdown当前行为一致。
- [x] ROADMAP/compatibility matrix统一Implementation+Evidence状态。
- [x] 用户README只说明真实可用功能，并明确Gateway MFA和真实环境证据边界。
- [x] 公开Release说明聚焦用户可感知的修复和完善；签名、公证、真实canary与长期soak等
  工程证据边界保留在本gate，不要求复制到公开Release说明。

## 11. Release decision

代码、package和发布链审查已经通过。维护者于2026-08-23明确接受以下未验证边界作为
v1.2.3发布风险，而不是把它们改写为已验证：真实Gateway/HPC/Clash/SSH/SAML canary、
30分钟packaged soak、`main` branch protection、Developer ID/notarization与Windows
Authenticode。这些边界由工程gate持续追踪，不要求公开Release说明逐项展开。

正式发布要求已经满足：PR以merge commit进入`main`；`v1.2.3`精确指向该merge commit；
同一tag run三平台build/verifier/smoke及唯一release job全部成功；四个正式资产已复核。

当前结论：

```text
1.x Architecture Frozen: NO
v1.2.3 Release: PUBLISHED (tagged clean build PASS)
```
