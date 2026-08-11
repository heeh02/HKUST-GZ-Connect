<div align="center">

<img src="desktop/assets/logo.svg" alt="HKUST(GZ) logo" height="84" />

# HKUST(GZ) Connect

面向香港科技大学（广州）校园网络的跨平台 EasyConnect 兼容客户端<br>
Cross-platform EasyConnect-compatible client for HKUST(GZ)

[中文](#中文) · [English](#english)

![Release](https://img.shields.io/github/v/release/heeh02/hkustgzconnect)
![macOS](https://img.shields.io/badge/macOS-Apple_Silicon_%7C_Intel-000?logo=apple&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-x64-0078D6?logo=windows&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-x86__64_AppImage-FCC624?logo=linux&logoColor=111)
![Engine](https://img.shields.io/badge/engine-Rust-CE412B?logo=rust&logoColor=white)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

</div>

---

# 中文

## 项目简介

HKUST(GZ) Connect 是面向师生的校园网络客户端。只想访问校内网站时，不需要
了解代理、安装 Clash 或修改浏览器：登录后点击“打开校园网站”即可。

应用内置一个与日常浏览器隔离、支持多标签页的校园浏览器。它的请求进入校园
隧道，而 Safari、Edge、Chrome 和其他软件继续使用原有网络。高级用户仍可使用
本机 SOCKS5、PAC、SSH 或 Clash/Mihomo。

版本技术路线：

- `0.3.x` 系列基于 `zju-connect`。
- 从 `1.0.0` 开始，项目改为基于对官方 EasyConnect 客户端和协议的授权分析，
  使用模块化 Rust 引擎重新实现。

默认模式不会修改系统 DNS、系统代理或默认路由。即使连接异常或强制退出，也
不会在系统中留下 EasyConnect 常见的 DNS/路由残留。

## 1.2.2 HPC 内部 DNS 修复

1.2.1 及更早版本在网关未通过 `conf.csp` 下发 DNS 时，会按学校生产配置回退到
操作系统 DNS。`hpc2login.hpc.hkust-gz.edu.cn` 等仅存在于校园内部 DNS 的域名
因此会被公共 DNS 判定为不存在，SOCKS5 连接会在进入校园隧道前失败。

1.2.2 将解析路径改为长期可维护的隧道内策略：

- 网关以后重新下发 DNS 时，动态地址仍会自动采用；
- 学校配置的 `10.90.63.2`、`10.90.63.3` 作为当前生产 profile 的冗余来源；
- 动态与学校配置地址会去重并并发查询，首个有效结果进入有界 TTL 缓存；
- 生产 profile 关闭系统 DNS fallback，内部域名不会再交给公共 DNS；
- 所有 DNS UDP 包只经过 Rust 用户态校园隧道，不修改系统 DNS、默认路由或
  其他浏览器的网络环境；界面会区分网关 DNS、学校 DNS 或两者组合。

DNS 地址属于可审核的学校部署配置，而不是散落在 SOCKS 代码中的硬编码。学校
以后调整 DNS 时只需更新 profile 并发布维护版本，无需重写解析器。

## 1.2.1 核心结果

> **版本定位：** 1.2.1 是建立在 1.2.0 用户功能之上的维护性与可维护性更新。
> 多标签校园浏览器、域名分流、PAC、Clash/SSH、严格本地认证、密码库和自动
> 重连均已由 1.2.0 提供。1.2.1 不宣称已经支持 EasyConnect 的资源目录、
> WebVPN、MFA、证书或 USB Key；这些能力仍按路线图逐项实现和验证。

- Rust 引擎现在通过 Event API v1 输出带原因与连接代次的结构化 `stopped`
  事件；桌面端只接受当前引擎代次的终止结果，不再依赖解析英文日志判断状态。
- 桌面端和引擎在已有的私有标准输入管道上协商有界 Control API v2，优先请求
  引擎自行停止并退出登录；控制失败或超时后仍保留有界的信号与强制停止兜底。
  Control v2 不开放新端口，也没有可携带任意密钥、令牌、网址或目标地址的字段。
- 认证会话与 Modern L3 已拆开：认证对象只保存已认证 HTTPS 会话、退出端点和
  不透明会话标识；L3 配置、隧道令牌、DNS、证书绑定与数据面归传输后端管理。
- 校园浏览器支持单页应用（SPA）的登录完成确认：只在同一 HTTPS 来源的密码
  表单稳定消失后询问保存，并继续排除修改/重置密码表单；保存仍需用户明确确认。
- 离线门禁用两个完全独立的 Electron 进程验证精确域名、子域名规则与 PAC 在
  整个应用重启后仍然生效；测试只使用临时应用数据，不读取用户浏览器资料。
- 新增轻量性能基线：隐藏窗口不得枚举应用且计时器数量有界，20 标签页测试验证
  单 Session、切换延迟和视图生命周期。阈值是防挂死/灾难回归门禁，不代表真实
  校园网关延迟或吞吐承诺。
- 诊断日志同时受时间和空间约束：最多保留 3 天，当前文件和一个轮转文件各不
  超过 8 MiB；过期窗口会自动清空，日志不会无限增长。

### 版本策略

- 后续 `1.x.x` 只维护当前已提供的连接、校园浏览器、域名分流、SOCKS/PAC、
  Clash/SSH 和本地凭据能力，不再把未验证的 EasyConnect 功能塞入维护版本。
- 全面适配 EasyConnect 可选能力的候选版本命名为 `2.0.0`。本次只保留
  [现状与备选计划](ROADMAP.md)；只有学校实际启用资源目录、WebVPN、多线路、
  MFA、SSO 或硬件认证中的某项时，才针对该能力启动实现和实机验证。

> 如果觉得 HKUST(GZ) Connect 好用，欢迎在 GitHub 给项目一个 ⭐ Star；谢谢支持！

## 下载

请从 [GitHub Releases](https://github.com/heeh02/hkustgzconnect/releases/latest)
下载最新版本。

| 系统 | 下载文件 | 说明 |
| --- | --- | --- |
| macOS Apple Silicon | `hkustgzconnect-<版本>-mac-arm64.dmg` | M1/M2/M3/M4 等 |
| macOS Intel | `hkustgzconnect-<版本>-mac-x64.dmg` | Intel Mac |
| Windows | `hkustgzconnect-<版本>-win-x64.exe` | Windows 10/11 x64 |
| Linux | `hkustgzconnect-<版本>-linux-x64.AppImage` | 主流 x86_64 桌面发行版 |

### 安装

当前 Release 的 macOS 构建可能没有 Apple Developer ID 签名（ad-hoc 签名）。
从 Releases 下载 dmg 并把应用拖入“应用程序”后，如果 macOS 提示
“无法验证开发者”或应用“已损坏”：

- 在 Finder 中右键点击应用并选择“打开”，然后在对话框中再次确认；或
- 打开“系统设置”→“隐私与安全性”，在相应提示处点击“仍要打开”。

Windows 未签名构建可能显示 SmartScreen 提示：点击“更多信息”，然后选择
“仍要运行”。

Linux 下载 AppImage 后无需安装到系统目录：

```bash
chmod +x hkustgzconnect-<版本>-linux-x64.AppImage
./hkustgzconnect-<版本>-linux-x64.AppImage
```

如果发行版没有启用 FUSE，可使用 `--appimage-extract-and-run` 启动。Linux 只有
在系统提供 Secret Service/密钥环时才保存密码；否则应用会拒绝明文持久化，用户
可在每次启动时输入密码。

## 最简单的使用方法（推荐）

1. 安装并打开 HKUST(GZ) Connect。
2. 输入学校 VPN 账号和密码。密码由 macOS Keychain、Windows DPAPI 或 Linux
   Secret Service 加密保存；没有安全密钥环时不会明文保存。
3. 点击“登录并连接”，然后点击“打开校园网站”。

校园浏览器由应用自带，无需另装 Chrome。可在输入框粘贴任意校内网址；留空则
打开学校主页。可以像普通浏览器一样新建、切换和关闭多个标签页，也支持
`⌘/Ctrl+T`、`⌘/Ctrl+W` 和 `⌘/Ctrl+L`。校园浏览器按域名规则自动选择校园
隧道或直连；标记为“直连”的合作站点使用本机原有网络，重定向回校内域名后
又会自动进入校园隧道，其他应用不受影响。

在 HTTPS 登录页提交账号密码后，校园浏览器只会在后续导航成功，或同一来源的
SPA 密码表单稳定消失后询问是否保存。只有用户明确点击“保存”才会写入；凭据按
网站来源隔离，并由 macOS Keychain 或 Windows DPAPI 加密后存放在本机。地址栏
旁的密码按钮可填入或删除当前网站的凭据。凭据不会进入日志或诊断包；除用户
原本登录的目标网站外，不会发送给项目维护者或 GitHub。

主 VPN 账号与加密密码采用同一份本机事务日志提交。即使保存过程中应用崩溃或
电脑断电，下次启动也只会恢复成一组相互匹配的账号和密码；无法证明一致时会
清除本机密码并禁止自动连接，不会拿旧账号配新密码反复尝试。

### 常用网站与合作站点

首页的“常用网站”默认只显示一小组入口，点击“展开全部”可以查看其余网站。
点击“管理”可以在本机新增、编辑、删除和上下移动自定义入口；这些入口只写入
当前电脑的应用数据，不会同步到账号、服务器或 GitHub。

每个入口都有独立的网络路径：

- **校园隧道**：通过 HKUST(GZ) Connect 访问校内资源；
- **直连**：使用当前电脑原有网络访问合作服务，不经过校园隧道。

Outlook (`outlook.office.com`) 和 Canvas (`hkust-gz.instructure.com`) 默认
标记为“直连”，因此不会因为校园隧道出口而打不开。校园浏览器地址栏也提供
网络路径选择器；选择后立即记住当前精确域名，并影响以后打开的同域名页面。
在“网络规则”管理中还可以改为覆盖该域名的全部子域名。规则只保存在本机，
不会改变系统网络或其他浏览器。

> 普通用户到这里就可以了。下面的 SOCKS、PAC、SSH 和 Clash 内容只面向需要
> 访问服务器、数据库或把其他软件接入校园网的高级用户。

### 常见问题

- **连接后平时上网会变慢吗？** 不会。默认只隔离处理校园浏览器和显式接入的
  高级工具。
- **需要 Clash 吗？** 访问校内网站不需要。只有需要复杂分流时才建议使用。
- **会抢 DNS 吗？** 不会。应用不替换系统 DNS，也不安装全局 DNS 服务。
- **关闭后还能恢复网络吗？** 默认从未改动系统网络设置，因此无需恢复。
- **校园网页密码保存在哪里？** 只保存在当前电脑的应用数据目录中，密码正文
  由操作系统凭据系统加密。Linux 没有可用密钥环而只能退化为明文后端时，应用
  会拒绝保存。
- **网址没有打开怎么办？** 确认状态为“已连接”，把完整网址（包括
  `http://` 或 `https://`）粘贴到校园网站输入框；仍失败可在“通知”中查看
  脱敏日志并联系维护人员。
- **合作网站打不开怎么办？** 在该标签页地址栏选择“直连”。Outlook 和 Canvas
  等已知合作站点默认使用直连；自定义入口也可以在“管理”中选择直连。
- **SSH/Clash 如何使用本地端口？** 默认兼容标准无认证 SOCKS5，直接使用控制塔
  显示的 `127.0.0.1` 端口即可。若要开启“严格本地代理认证”，分别点击控制塔的
  “复制 Clash 节点”和“复制 SSH 配置”并粘贴一次；之后重连、重启或切换严格模式
  都无需重新配置。

## 高级用户接入

`1080` 是默认 SOCKS5 端口，可以在应用设置中修改。修改后请同步更新 SSH、
Clash 和其他软件中的端口。

新安装默认使用兼容模式，因此外部 PAC、SSH、Clash/Mihomo 可以直接连接标准
SOCKS5 端口。端口始终只监听 `127.0.0.1`，不会暴露到局域网；但同一台电脑上
的其他进程或登录用户仍可能借用已认证的校园会话。共享电脑可在控制塔主动开启
“严格本地代理认证”。应用内校园浏览器会自动认证；Clash 和 SSH 使用控制塔
生成的配置即可继续工作，不需要每次重连后更新凭据。严格认证开关会立即保存，
并在已连接时自动重连；不再需要另外点击页面底部的“保存”。

## 为什么 SSH 必须指定代理端口

HKUST(GZ) Connect 不创建系统级虚拟网卡，也不会接管所有网络流量。它只在
`127.0.0.1` 暴露一个本地 SOCKS5 入口，因此 SSH 必须通过 `ProxyCommand`
明确连接这个端口。

兼容模式仍可使用系统 `nc`。若希望同一份配置同时适用于兼容与严格模式，请先在
控制塔点击“复制 SSH 配置”。应用会生成使用随包原生 `ec-proxy-command` helper
的 `ProxyCommand`；helper 从仅当前用户可读的短期本机文件取得认证信息，密码
不会进入命令行、SSH 配置或日志。把复制结果放进目标主机的 `Host` 块，例如：

```sshconfig
Host hkustgz-hpc
    HostName 10.120.48.30
    User <你的校园用户名>
    # 在这里粘贴应用生成的 ProxyCommand
```

helper 会同时协商无认证和严格认证，因此切换模式、重连或重启应用后不需要修改
SSH 配置。修改本地 SOCKS 端口时，应用会在下次连接时自动更新 helper 使用的
本机端点。连接命令保持不变：

```bash
ssh hkustgz-hpc
```

## 建议配合 Clash/Mihomo 使用

如果已有 Clash、Clash Verge Rev 或 Mihomo，建议保持规则模式。先在控制塔点击
“复制 Clash 节点”，再把剪贴板中的节点粘贴到 Clash 配置；节点已经包含当前
端口、稳定的本机认证信息和 `udp: false`。应用不会读取或改写你的 Clash 配置。
随后把校园规则指向 `HKUSTGZ`，让其他流量继续使用原有规则。

```yaml
proxies:
  - name: HKUSTGZ
    type: socks5
    server: 127.0.0.1
    port: 1080
    username: <请使用应用复制出的值>
    password: <请使用应用复制出的值>
    udp: false

rules:
  - DOMAIN-SUFFIX,hkust-gz.edu.cn,HKUSTGZ
  - DOMAIN-SUFFIX,hkust.edu.hk,HKUSTGZ
  - IP-CIDR,10.0.0.0/8,HKUSTGZ,no-resolve
  # 将以上规则放在 MATCH/GEOIP 等兜底规则之前
```

注意：

- 必须先连接 HKUST(GZ) Connect，再启用这些 Clash 规则。
- 如果应用中修改了 SOCKS 端口，请重新点击一次“复制 Clash 节点”并更新节点；
  普通重连、重启以及切换严格模式不需要更新。
- 建议使用 Clash 规则模式；不需要为了本项目启用 Clash TUN 或改写系统 DNS。
- 复制出的认证节点可同时用于兼容模式和严格模式。严格模式仍不提供 SOCKS UDP，
  因此节点固定为 `udp: false`。
- 端口始终只绑定 `127.0.0.1`，不会监听局域网，但本机其他进程也可使用该会话。

## 指定网站自动走校园隧道

在“网络规则”中可以保存精确域名，或选择“包含全部子域名”；高级设置仍可维护
外部 PAC 使用的校园域名列表，例如：

```text
hkust-gz.edu.cn
hkust.edu.hk
example.internal
```

生成的 PAC 会将这些域名、它们的子域名和字面量 `10.*` 地址发送到本地
SOCKS5 端口，其他网站保持直连。PAC 不执行 `dnsResolve()`，不会主动抢占
或重写系统 DNS。

校园浏览器、常用网站和外部 PAC 共用同一套优先级明确的规则。浏览器使用单一
隔离 Session，因此 Microsoft/Canvas 直连登录、SAML 重定向和返回校内网站时
不会因切换网络路径而丢失 Cookie、POST 或标签历史。外部 PAC 文件本身不能
携带代理凭据；严格模式下请使用应用内校园浏览器，或使用控制塔生成的认证
Clash/SSH 配置。

## 技术路径

```text
Electron 桌面界面
    -> 系统安全存储（Keychain / DPAPI）
    -> Rust 认证会话 + L3 传输后端
    -> EasyConnect 兼容传输层
    -> IPv4 数据包校验与分帧
    -> 用户态 TCP/UDP 网络栈
    -> 本机显式代理前端
       -> 应用内隔离校园浏览器（默认）
       -> PAC / SOCKS5 / Clash / SSH（高级）
```

协议、认证、传输、用户态网络栈、SOCKS5、PAC 和桌面生命周期分别位于独立
模块。网关升级时可以只更新受影响的适配器或传输模块。

主要特性：

- Rust 数据面和用户态 TCP/IP；
- SOCKS5 TCP CONNECT；兼容无认证模式提供 UDP ASSOCIATE，严格认证模式为避免
  本机其他进程劫持 UDP relay 而明确拒绝 UDP；
- 自动重连、连接状态和安全日志；
- 无需外部浏览器或代理软件的校园浏览器；
- 持久化精确域名/子域名规则与选择性 PAC；
- 浏览器断开时先进入 fail-closed，再释放本地代理端口；
- 可选严格本地代理认证、WebRTC 非代理 UDP 禁用、证书例外按精确来源与指纹保存；
- 不修改系统 DNS、全局代理或路由表；
- macOS Apple Silicon/Intel、Windows x64 与 Linux x86_64 AppImage 自动构建。

## 命令行使用（macOS）

```bash
cp config.toml.example config.toml
./hkustgzconnect set-password
./hkustgzconnect up
./hkustgzconnect status
./hkustgzconnect test
./hkustgzconnect down
```

密码保存在 macOS Keychain，并通过标准输入传递给 Rust 引擎，不会出现在
进程参数或配置文件中。

## 开发与验证

```bash
cd independent
cargo build --locked --release --bin ec-engine
cargo test --locked
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings

cd ../desktop
npm ci
npm test
npm run test:main-integration
npm run test:renderer-layout
npm run test:routing-restart
npm run test:idle-performance
npm run test:browser-performance
bash scripts/build-engine.sh
npm start
```

进一步资料：

- [架构与模块边界](independent/ARCHITECTURE.md)
- [1.2.2 路线图与证据状态](ROADMAP.md)
- [桌面端安全模型](desktop/SECURITY.md)
- [维护策略](independent/MAINTENANCE.md)
- [Engine Control API v2](independent/spec/ENGINE_CONTROL_API_V2.md)
- [升级与持续可用方案](independent/UPGRADE_PLAYBOOK.md)
- [面向学校部署的易用性与网络隔离方案](independent/SCHOOL_DEPLOYMENT.md)
- [协议说明](independent/spec/PROTOCOL.md)
- [兼容性矩阵](independent/spec/COMPATIBILITY_MATRIX.md)
- [EasyConnect 功能对齐与前向兼容计划](independent/spec/FEATURE_PARITY.md)

---

# English

## Overview

HKUST(GZ) Connect is a campus-network client for students and staff. If all
you need is a campus website, you do not need to understand proxies, install
Clash, or change browser settings: sign in and click **Open Campus Website**.

The built-in multi-tab Campus Browser is isolated from your everyday browser.
Campus-tunnel tabs use the campus tunnel, while Direct tabs use the computer's
existing network. Safari, Edge, Chrome, and other applications keep their
existing network. Advanced users can still use the
local SOCKS5 endpoint, PAC, SSH, or Clash/Mihomo.

Version history:

- The `0.3.x` series was based on `zju-connect`.
- Starting with `1.0.0`, the project is based on authorized analysis of the
  official EasyConnect client and protocol, with a modular Rust engine.

The default mode does not change operating-system DNS, the global proxy, or
the default route. A failed connection or forced exit therefore does not
leave EasyConnect-style DNS or routing residue behind.

## 1.2.2 HPC split-horizon DNS fix

In 1.2.1 and earlier, the school production profile fell back to operating-
system DNS whenever the gateway omitted DNS from `conf.csp`. Names that exist
only in campus DNS, including `hpc2login.hpc.hkust-gz.edu.cn`, could therefore
receive a public NXDOMAIN result and fail before SOCKS5 opened the tunnel TCP
connection.

Version 1.2.2 replaces that behavior with a maintainable VPN-only policy:

- gateway-advertised DNS is still adopted automatically if it appears later;
- `10.90.63.2` and `10.90.63.3` are reviewed fallback sources in the current
  school deployment profile;
- gateway and profile addresses are deduplicated and queried concurrently,
  with the first valid answer entering the bounded TTL cache;
- system DNS fallback is disabled in the production profile, so internal names
  are no longer sent to public DNS;
- every DNS UDP packet stays inside the Rust userspace campus tunnel. The app
  still does not change OS DNS, the default route, or other browsers, and the
  UI distinguishes gateway DNS, campus-profile DNS, and their combined mode.

The DNS addresses live in the reviewed deployment profile rather than being
scattered through SOCKS code. A future school DNS change therefore requires a
profile maintenance update, not a resolver rewrite.

## 1.2.1 core results

> **Release positioning:** 1.2.1 is a maintenance and maintainability update
> built on the user-facing features delivered in 1.2.0. Multi-tab Campus
> Browser, domain routing, PAC, Clash/SSH, strict local authentication, the
> credential vault, and automatic reconnect already shipped in 1.2.0. Version
> 1.2.1 does not claim support for EasyConnect resource catalogues, WebVPN,
> MFA, certificate authentication, or USB keys; those remain roadmap items
> that require separate implementation and validation.

- The Rust engine now emits a structured Event API v1 `stopped` event with a
  reason and connection generation. Desktop accepts a terminal result only
  from the current generation instead of inferring state from English logs.
- Desktop and engine negotiate bounded Control API v2 over the existing
  inherited private stdin pipe. Graceful engine shutdown and logout are tried
  first, with bounded signal and forced-stop fallbacks. Control v2 opens no new
  port and has no arbitrary field capable of carrying credentials, tokens,
  URLs, or destination addresses.
- Authentication and Modern L3 are separated. The authenticated object retains
  only the HTTPS session, logout endpoint, and opaque session identifier; L3
  configuration, tunnel token, DNS, certificate binding, and data plane belong
  to the transport backend.
- Campus Browser now confirms same-document SPA login completion only after the
  password form stays absent on the same HTTPS origin. Password-change/reset
  forms remain excluded, and saving still requires explicit user confirmation.
- An offline gate launches two completely separate Electron processes to prove
  that exact-domain/subdomain rules and the PAC survive a full app restart. It
  uses temporary application data and never reads the user's browser profile.
- Lightweight performance baselines cover zero hidden-window application
  enumeration, bounded timers, one Session across 20 tabs, switch latency, and
  view lifecycle. Their broad thresholds catch hangs or catastrophic
  regressions; they are not campus-gateway latency or throughput promises.
- Diagnostic logs are bounded by both time and size: at most three days, with
  one current and one rotated file capped at 8 MiB each. Expired windows are
  cleared automatically, so logs cannot grow without bound.

### Version policy

- Future `1.x.x` releases maintain the existing connection, Campus Browser,
  domain-routing, SOCKS/PAC, Clash/SSH, and local-credential features. They do
  not fold unverified EasyConnect capabilities into maintenance releases.
- The candidate for broad EasyConnect optional-capability support is named
  `2.0.0`. This release keeps only the [current status and contingency
  plan](ROADMAP.md). Implementation and live validation begin only if the
  school actually enables a relevant resource catalogue, WebVPN, multiple
  lines, MFA, SSO, or hardware-authentication feature.

## Download

Download the latest build from
[GitHub Releases](https://github.com/heeh02/hkustgzconnect/releases/latest).

| Platform | Asset | Notes |
| --- | --- | --- |
| macOS Apple Silicon | `hkustgzconnect-<version>-mac-arm64.dmg` | M1/M2/M3/M4 |
| macOS Intel | `hkustgzconnect-<version>-mac-x64.dmg` | Intel Macs |
| Windows | `hkustgzconnect-<version>-win-x64.exe` | Windows 10/11 x64 |
| Linux | `hkustgzconnect-<version>-linux-x64.AppImage` | Mainstream x86_64 desktops |

### Installation

The macOS builds on Releases may be ad-hoc signed (no Apple Developer ID
signature). After downloading the dmg and dragging the app into Applications,
if macOS says the developer “cannot be verified” or the app “is damaged”:

- Right-click the app in Finder and choose **Open**, then confirm in the
  dialog; or
- Open **System Settings → Privacy & Security** and click **Open Anyway**.

Unsigned Windows builds may show a SmartScreen prompt: click **More info**,
then **Run anyway**.

The Linux AppImage runs without installation into a system directory:

```bash
chmod +x hkustgzconnect-<version>-linux-x64.AppImage
./hkustgzconnect-<version>-linux-x64.AppImage
```

On distributions without FUSE, use `--appimage-extract-and-run`. Linux stores
passwords only when a Secret Service/keyring backend is available; otherwise
the app refuses plaintext persistence and the password can be entered each
time it starts.

## Easiest setup (recommended)

1. Install and open HKUST(GZ) Connect.
2. Enter the campus VPN username and password. The password is protected by
   macOS Keychain, Windows DPAPI, or Linux Secret Service; it is not persisted
   as plaintext when no secure keyring is available.
3. Click **Sign in and connect**, then click **Open Campus Website**.

Campus Browser ships with the app; a separate Chrome installation is not
required. Paste any campus URL into the field, or leave it empty to open the
university home page. Open, switch, and close tabs as in a normal browser;
`Cmd/Ctrl+T`, `Cmd/Ctrl+W`, and `Cmd/Ctrl+L` are supported. A shared domain
policy chooses Campus tunnel or Direct per site, and a redirect back to a
campus domain automatically returns to the tunnel without changing other
applications.

After an HTTPS login form is submitted, Campus Browser asks whether to save the
credential only after a successful later navigation or stable disappearance of
the password form in a same-origin SPA. Nothing is stored without that explicit
choice. Credentials are isolated by exact website origin and encrypted locally
through macOS Keychain or Windows DPAPI. The password button next to the address
field can fill or remove the current site's credential. Passwords never enter
logs or diagnostic bundles and, beyond the site the user is signing into, are
not sent to the maintainer or GitHub.

The main VPN account and encrypted password are committed under one local
transaction journal. If the app or computer stops during a save, startup only
restores a proven matching pair. If consistency cannot be established, the
local password is cleared and automatic connection is blocked instead of
trying a new password with an old account.

### Shortcuts and partner services

The **Common Websites** shelf is collapsed to a compact set by default. Use
**Show all** to expand it, or **Manage** to add, edit, delete, and reorder local
shortcuts. Custom shortcuts are stored only in this computer's application data;
there is no account sync, server storage, or import/export.

Each shortcut has an independent route:

- **Campus tunnel** sends the tab through HKUST(GZ) Connect;
- **Direct** uses the computer's existing network for partner services.

Outlook (`outlook.office.com`) and Canvas (`hkust-gz.instructure.com`) default to
**Direct**, avoiding failures caused by the campus tunnel's egress. The browser
toolbar also exposes a route selector. A selection is remembered immediately
for that exact domain and applies to future pages; the Network Rules manager
can extend a rule to every subdomain. Rules remain local to this computer.

> Ordinary Web users can stop here. SOCKS, PAC, SSH, and Clash below are
> advanced integrations for servers, databases, and other applications.

### FAQ

- **Will normal browsing slow down?** No. The default only handles Campus
  Browser and tools explicitly configured to use the local endpoint.
- **Is Clash required?** No. It is optional for advanced routing.
- **Does it take over DNS?** No. It does not replace system DNS or install a
  global DNS service.
- **Does the network need repair after quitting?** No system network setting
  was changed in the default mode.
- **What if a site does not open?** Confirm the connection is active and paste
  the complete `http://` or `https://` URL. If it still fails, use the
  redacted log under Notifications when contacting support.
- **What if a partner site does not open?** Choose **Direct** in that tab's
  route selector. Known Outlook and Canvas shortcuts already use Direct, and
  custom shortcuts can be configured the same way.
- **How do SSH and Clash use the local port?** Compatibility mode is the
  default, so the `127.0.0.1` endpoint shown in Control Tower works directly.
  To use strict local-proxy authentication, click **Copy Clash Node** and
  **Copy SSH Config** once. The resulting configurations survive reconnects,
  restarts, and later strict-mode toggles.

## Advanced integrations

Port `1080` is the default SOCKS5 port and can be changed in Settings. Update
every advanced client configuration after changing it.

New installations default to standard SOCKS5 compatibility, so external PAC,
SSH, and Clash/Mihomo clients work without an app-specific credential. The
listener remains bound to `127.0.0.1`, never the LAN, although another process
or logged-in user on the same computer may borrow the authenticated session.
Shared-computer users can explicitly enable **Strict local proxy
authentication**. Campus Browser authenticates automatically, while Clash and
SSH continue to work with the one-time configurations generated by Control
Tower. The strict-authentication switch saves immediately and automatically
reconnects an active session; the separate Save button is not required.

## SSH through the exposed port

HKUST(GZ) Connect does not create a system-wide virtual interface or capture
all traffic. It exposes one SOCKS5 endpoint on `127.0.0.1`, so SSH must use an
explicit `ProxyCommand`.

Compatibility mode can still use the system `nc`. For one configuration that
also works in strict mode, click **Copy SSH Config** in Control Tower. The app
generates a `ProxyCommand` using the bundled native `ec-proxy-command` helper.
The helper obtains authentication data from a short-lived owner-only local
file, so the password never appears in the command line, SSH config, or logs.
Paste the generated line into a host block such as:

```sshconfig
Host hkustgz-hpc
    HostName 10.120.48.30
    User <campus-username>
    # Paste the ProxyCommand generated by the app here.
```

The helper negotiates both compatibility and strict authentication. Reconnects,
app restarts, and strict-mode toggles therefore do not require another SSH
configuration change. The connection command remains:

```bash
ssh hkustgz-hpc
```

## Recommended Clash/Mihomo integration

When Clash, Clash Verge Rev, or Mihomo is already installed, keep it in Rule
mode. Click **Copy Clash Node** in Control Tower, paste the clipboard content
into the Clash configuration, then point the campus rules at `HKUSTGZ`. The
generated node already contains the current port, stable local authentication,
and `udp: false`. The app never reads or modifies the Clash configuration.

```yaml
proxies:
  - name: HKUSTGZ
    type: socks5
    server: 127.0.0.1
    port: 1080
    username: <use the value copied by the app>
    password: <use the value copied by the app>
    udp: false

rules:
  - DOMAIN-SUFFIX,hkust-gz.edu.cn,HKUSTGZ
  - DOMAIN-SUFFIX,hkust.edu.hk,HKUSTGZ
  - IP-CIDR,10.0.0.0/8,HKUSTGZ,no-resolve
  # Keep these rules before MATCH, GEOIP, and other catch-all rules.
```

Notes:

- Connect HKUST(GZ) Connect before enabling these rules.
- After changing the local SOCKS port, copy and replace the node once. Ordinary
  reconnects, restarts, and strict-mode toggles require no change.
- Rule mode is recommended. This project does not require Clash TUN mode or
  any system DNS rewrite.
- The copied authenticated node works in both compatibility and strict modes.
  Strict mode does not expose SOCKS UDP, so the node always uses `udp: false`.
- The endpoint binds only to `127.0.0.1`, although other local processes can
  use the session in compatibility mode.

## Route selected websites automatically

Network Rules can store an exact domain or include all of its subdomains. The
advanced campus-domain list used by the external PAC still accepts one domain
per line:

```text
hkust-gz.edu.cn
hkust.edu.hk
example.internal
```

The PAC routes those domains, their subdomains, and literal `10.*` addresses
to the local SOCKS5 endpoint. Other websites remain direct. The PAC never
calls `dnsResolve()` and does not replace the system DNS configuration.

Campus Browser, shortcuts, and the external PAC share the same ordered policy.
Campus Browser keeps one isolated Session, so Direct Microsoft/Canvas login,
SAML redirects, and a return to a campus domain do not lose cookies, POST
state, or tab history. A PAC file cannot carry proxy credentials; in strict
mode, use Campus Browser or the authenticated Clash/SSH configuration generated
by Control Tower.

## Technical path

```text
Electron desktop UI
    -> OS-protected credentials (Keychain / DPAPI)
    -> Rust authentication session + L3 transport backend
    -> EasyConnect-compatible transport
    -> bounded IPv4 validation and framing
    -> userspace TCP/UDP stack
    -> explicit local frontends
       -> isolated Campus Browser (default)
       -> PAC / SOCKS5 / Clash / SSH (advanced)
```

Authentication, transport, packet framing, userspace networking, SOCKS5, PAC,
and desktop lifecycle are separate modules. A gateway update should normally
change only the affected adapter or transport module.

Key features:

- Rust data plane and userspace TCP/IP;
- SOCKS5 TCP CONNECT; UDP ASSOCIATE is available only in unauthenticated
  compatibility mode and is rejected in strict mode to prevent local relay
  ownership theft;
- reconnect handling, status reporting, and private logs;
- a built-in Campus Browser with no external proxy application;
- persistent exact-domain/subdomain rules and domain-selective PAC routing;
- fail-closed Campus Browser suspension before the fixed local port is released;
- optional strict local proxy authentication, non-proxied WebRTC UDP disabled,
  and certificate exceptions scoped to an exact origin and fingerprint;
- no operating-system DNS, global proxy, or routing-table modification;
- automated macOS Apple Silicon/Intel, Windows x64, and Linux x86_64 AppImage
  builds.

## macOS CLI

```bash
cp config.toml.example config.toml
./hkustgzconnect set-password
./hkustgzconnect up
./hkustgzconnect status
./hkustgzconnect test
./hkustgzconnect down
```

The password is stored in macOS Keychain and passed to the Rust engine through
standard input. It is not placed in process arguments or configuration files.

## Development

```bash
cd independent
cargo build --locked --release --bin ec-engine
cargo test --locked
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings

cd ../desktop
npm ci
npm test
npm run test:main-integration
npm run test:renderer-layout
npm run test:routing-restart
npm run test:idle-performance
npm run test:browser-performance
bash scripts/build-engine.sh
npm start
```

Further documentation:

- [Architecture and module ownership](independent/ARCHITECTURE.md)
- [1.2.2 roadmap and evidence status](ROADMAP.md)
- [Desktop security model](desktop/SECURITY.md)
- [Maintenance policy](independent/MAINTENANCE.md)
- [Engine Control API v2](independent/spec/ENGINE_CONTROL_API_V2.md)
- [Upgrade and continuity playbook](independent/UPGRADE_PLAYBOOK.md)
- [School deployment and usability plan (Chinese)](independent/SCHOOL_DEPLOYMENT.md)
- [Protocol specification](independent/spec/PROTOCOL.md)
- [Compatibility matrix](independent/spec/COMPATIBILITY_MATRIX.md)
- [EasyConnect parity and forward-compatibility plan](independent/spec/FEATURE_PARITY.md)

## License

GPL-3.0-only.
