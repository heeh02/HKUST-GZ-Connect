<div align="center">

<img src="desktop/assets/logo.svg" alt="HKUST(GZ) logo" height="84" />

# HKUST(GZ) Connect

面向香港科技大学（广州）校园网络的跨平台 EasyConnect 兼容客户端<br>
Cross-platform EasyConnect-compatible client for HKUST(GZ)

[中文](#中文) · [English](#english)

![Release](https://img.shields.io/github/v/release/heeh02/hkustgzconnect)
![macOS](https://img.shields.io/badge/macOS-Apple_Silicon_%7C_Intel-000?logo=apple&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-x64-0078D6?logo=windows&logoColor=white)
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

> 如果觉得 HKUST(GZ) Connect 好用，欢迎在 GitHub 给项目一个 ⭐ Star；谢谢支持！

## 下载

请从 [GitHub Releases](https://github.com/heeh02/hkustgzconnect/releases/latest)
下载最新版本。

| 系统 | 下载文件 | 说明 |
| --- | --- | --- |
| macOS Apple Silicon | `hkustgzconnect-1.0.4-mac-arm64.dmg` 或 `.zip` | M1/M2/M3/M4 等 |
| macOS Intel | `hkustgzconnect-1.0.4-mac-x64.dmg` 或 `.zip` | Intel Mac |
| Windows | `hkustgzconnect-1.0.4-win-x64.exe` | Windows 10/11 x64 |

Release 同时提供 `SHA256SUMS-macos.txt` 和 `SHA256SUMS-windows.txt`。
建议下载后核对校验值。

当前 macOS 构建如果没有 Developer ID 签名，请在 Finder 中右键应用并选择
“打开”。Windows 未签名构建可能显示 SmartScreen 提示。

## 最简单的使用方法（推荐）

1. 安装并打开 HKUST(GZ) Connect。
2. 输入学校 VPN 账号和密码。密码由 macOS Keychain 或 Windows DPAPI 加密保存。
3. 点击“登录并连接”，然后点击“打开校园网站”。

校园浏览器由应用自带，无需另装 Chrome。可在输入框粘贴任意校内网址；留空则
打开学校主页。可以像普通浏览器一样新建、切换和关闭多个标签页，也支持
`⌘/Ctrl+T`、`⌘/Ctrl+W` 和 `⌘/Ctrl+L`。校园浏览器内的域名解析和访问经过
隧道，其他应用不受影响。

在 HTTPS 登录页提交账号密码后，校园浏览器会询问是否保存。只有用户明确点击
“保存”才会写入；凭据按网站来源隔离，并由 macOS Keychain 或 Windows DPAPI
加密后存放在本机。地址栏旁的密码按钮可填入或删除当前网站的凭据。凭据不会
进入日志或诊断包；除用户原本登录的目标网站外，不会发送给项目维护者或
GitHub。

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

## 高级用户接入

`1080` 是默认 SOCKS5 端口，可以在应用设置中修改。修改后请同步更新 SSH、
Clash 和其他软件中的端口。

## 为什么 SSH 必须指定代理端口

HKUST(GZ) Connect 不创建系统级虚拟网卡，也不会接管所有网络流量。它只在
`127.0.0.1` 暴露一个本地 SOCKS5 入口，因此 SSH 必须通过 `ProxyCommand`
明确连接这个端口。

macOS/Linux `~/.ssh/config` 示例：

```sshconfig
Host hkustgz-hpc
    HostName 10.120.48.30
    User <你的校园用户名>
    ProxyCommand /usr/bin/nc -X 5 -x 127.0.0.1:1080 %h %p
```

Windows 使用 Git for Windows 自带 `connect.exe`：

```sshconfig
Host hkustgz-hpc
    HostName 10.120.48.30
    User <你的校园用户名>
    ProxyCommand "C:/Program Files/Git/mingw64/bin/connect.exe" -S 127.0.0.1:1080 %h %p
```

连接：

```bash
ssh hkustgz-hpc
```

应用的“复制 SSH 配置”按钮会根据当前端口生成相应的 `ProxyCommand`。

## 建议配合 Clash/Mihomo 使用

如果已有 Clash、Clash Verge Rev 或 Mihomo，建议保持规则模式，将
HKUST(GZ) Connect 添加为本地 SOCKS5 节点。这样指定校园域名和 `10.0.0.0/8`
地址走校园隧道，其他流量继续使用原有规则。

```yaml
proxies:
  - name: HKUSTGZ
    type: socks5
    server: 127.0.0.1
    port: 1080

rules:
  - DOMAIN-SUFFIX,hkust-gz.edu.cn,HKUSTGZ
  - DOMAIN-SUFFIX,hkust.edu.hk,HKUSTGZ
  - IP-CIDR,10.0.0.0/8,HKUSTGZ,no-resolve
  # 将以上规则放在 MATCH/GEOIP 等兜底规则之前
```

注意：

- 必须先连接 HKUST(GZ) Connect，再启用这些 Clash 规则。
- 如果应用中修改了 SOCKS 端口，Clash 配置也要同步修改。
- 建议使用 Clash 规则模式；不需要为了本项目启用 Clash TUN 或改写系统 DNS。
- 本地 SOCKS5 端口没有用户名密码认证，但只绑定到 `127.0.0.1`，不会监听局域网。

## 指定网站自动走校园隧道

应用设置中可以逐行填写域名，例如：

```text
hkust-gz.edu.cn
hkust.edu.hk
example.internal
```

生成的 PAC 会将这些域名、它们的子域名和字面量 `10.*` 地址发送到本地
SOCKS5 端口，其他网站保持直连。PAC 不执行 `dnsResolve()`，不会主动抢占
或重写系统 DNS。

该列表只服务于外部应用。应用内校园浏览器会把自身流量完整、隔离地送入校园
隧道，因此普通用户无需维护域名列表。

## 技术路径

```text
Electron 桌面界面
    -> 系统安全存储（Keychain / DPAPI）
    -> Rust 认证与会话模块
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
- SOCKS5 TCP CONNECT 与 UDP ASSOCIATE；
- 自动重连、连接状态和安全日志；
- 无需外部浏览器或代理软件的校园浏览器；
- 域名选择性 PAC；
- 不修改系统 DNS、全局代理或路由表；
- macOS Apple Silicon/Intel 与 Windows x64 自动构建。

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
bash scripts/build-engine.sh
npm start
```

进一步资料：

- [架构与模块边界](independent/ARCHITECTURE.md)
- [维护策略](independent/MAINTENANCE.md)
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
Its requests use the campus tunnel while Safari, Edge, Chrome, and other
applications keep their existing network. Advanced users can still use the
local SOCKS5 endpoint, PAC, SSH, or Clash/Mihomo.

Version history:

- The `0.3.x` series was based on `zju-connect`.
- Starting with `1.0.0`, the project is based on authorized analysis of the
  official EasyConnect client and protocol, with a modular Rust engine.

The default mode does not change operating-system DNS, the global proxy, or
the default route. A failed connection or forced exit therefore does not
leave EasyConnect-style DNS or routing residue behind.

## Download

Download the latest build from
[GitHub Releases](https://github.com/heeh02/hkustgzconnect/releases/latest).

| Platform | Asset | Notes |
| --- | --- | --- |
| macOS Apple Silicon | `hkustgzconnect-1.0.4-mac-arm64.dmg` or `.zip` | M1/M2/M3/M4 |
| macOS Intel | `hkustgzconnect-1.0.4-mac-x64.dmg` or `.zip` | Intel Macs |
| Windows | `hkustgzconnect-1.0.4-win-x64.exe` | Windows 10/11 x64 |

Each release also contains `SHA256SUMS-macos.txt` and
`SHA256SUMS-windows.txt`.

If a macOS build has no Developer ID signature, right-click the application
in Finder and choose **Open**. Unsigned Windows builds may show a SmartScreen
warning.

## Easiest setup (recommended)

1. Install and open HKUST(GZ) Connect.
2. Enter the campus VPN username and password. The password is protected by
   macOS Keychain or Windows DPAPI.
3. Click **Sign in and connect**, then click **Open Campus Website**.

Campus Browser ships with the app; a separate Chrome installation is not
required. Paste any campus URL into the field, or leave it empty to open the
university home page. Open, switch, and close tabs as in a normal browser;
`Cmd/Ctrl+T`, `Cmd/Ctrl+W`, and `Cmd/Ctrl+L` are supported. Its requests and
name resolution use the tunnel without changing other applications.

After an HTTPS login form is submitted, Campus Browser asks whether to save
the credential. Nothing is stored without that explicit choice. Credentials
are isolated by exact website origin and encrypted locally through macOS
Keychain or Windows DPAPI. The password button next to the address field can
fill or remove the current site's credential. Passwords never enter logs or
diagnostic bundles and, beyond the site the user is signing into, are not sent
to the maintainer or GitHub.

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

## Advanced integrations

Port `1080` is the default SOCKS5 port and can be changed in Settings. Update
every advanced client configuration after changing it.

## SSH through the exposed port

HKUST(GZ) Connect does not create a system-wide virtual interface or capture
all traffic. It exposes one SOCKS5 endpoint on `127.0.0.1`, so SSH must use an
explicit `ProxyCommand`.

macOS/Linux `~/.ssh/config`:

```sshconfig
Host hkustgz-hpc
    HostName 10.120.48.30
    User <campus-username>
    ProxyCommand /usr/bin/nc -X 5 -x 127.0.0.1:1080 %h %p
```

Windows with `connect.exe` from Git for Windows:

```sshconfig
Host hkustgz-hpc
    HostName 10.120.48.30
    User <campus-username>
    ProxyCommand "C:/Program Files/Git/mingw64/bin/connect.exe" -S 127.0.0.1:1080 %h %p
```

Connect with:

```bash
ssh hkustgz-hpc
```

The application's **Copy SSH config** action generates a `ProxyCommand` using
the currently configured port.

## Recommended Clash/Mihomo integration

When Clash, Clash Verge Rev, or Mihomo is already installed, keep it in Rule
mode and add HKUST(GZ) Connect as a local SOCKS5 node:

```yaml
proxies:
  - name: HKUSTGZ
    type: socks5
    server: 127.0.0.1
    port: 1080

rules:
  - DOMAIN-SUFFIX,hkust-gz.edu.cn,HKUSTGZ
  - DOMAIN-SUFFIX,hkust.edu.hk,HKUSTGZ
  - IP-CIDR,10.0.0.0/8,HKUSTGZ,no-resolve
  # Keep these rules before MATCH, GEOIP, and other catch-all rules.
```

Notes:

- Connect HKUST(GZ) Connect before enabling these rules.
- Keep the Clash port synchronized with the port configured in the app.
- Rule mode is recommended. This project does not require Clash TUN mode or
  any system DNS rewrite.
- The SOCKS5 endpoint has no username/password authentication, but it binds
  only to `127.0.0.1` and is not exposed to the LAN.

## Route selected websites automatically

Enter one domain per line in Settings:

```text
hkust-gz.edu.cn
hkust.edu.hk
example.internal
```

The PAC routes those domains, their subdomains, and literal `10.*` addresses
to the local SOCKS5 endpoint. Other websites remain direct. The PAC never
calls `dnsResolve()` and does not replace the system DNS configuration.

This list is only for external applications. Campus Browser sends its own
traffic through the campus tunnel in an isolated session, so ordinary users
do not need to maintain a domain list.

## Technical path

```text
Electron desktop UI
    -> OS-protected credentials (Keychain / DPAPI)
    -> Rust authentication and session modules
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
- SOCKS5 TCP CONNECT and UDP ASSOCIATE;
- reconnect handling, status reporting, and private logs;
- a built-in Campus Browser with no external proxy application;
- domain-selective PAC routing;
- no operating-system DNS, global proxy, or routing-table modification;
- automated macOS Apple Silicon/Intel and Windows x64 builds.

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
bash scripts/build-engine.sh
npm start
```

Further documentation:

- [Architecture and module ownership](independent/ARCHITECTURE.md)
- [Maintenance policy](independent/MAINTENANCE.md)
- [Upgrade and continuity playbook](independent/UPGRADE_PLAYBOOK.md)
- [School deployment and usability plan (Chinese)](independent/SCHOOL_DEPLOYMENT.md)
- [Protocol specification](independent/spec/PROTOCOL.md)
- [Compatibility matrix](independent/spec/COMPATIBILITY_MATRIX.md)
- [EasyConnect parity and forward-compatibility plan](independent/spec/FEATURE_PARITY.md)

## License

GPL-3.0-only.
