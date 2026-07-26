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

HKUST(GZ) Connect 将学校 EasyConnect 隧道转换为一个仅在本机监听的
SOCKS5 端口，供浏览器、Clash/Mihomo、SSH 及其他支持 SOCKS5 的软件使用。

版本技术路线：

- `0.3.x` 系列基于 `zju-connect`。
- 从 `1.0.0` 开始，项目改为基于对官方 EasyConnect 客户端和协议的授权分析，
  使用模块化 Rust 引擎重新实现。

当前版本不会修改系统 DNS、系统代理或默认路由。只有明确使用本地 SOCKS5
端口、PAC 文件或“校园浏览器”的流量才会进入校园隧道。

## 下载

请从 [GitHub Releases](https://github.com/heeh02/hkustgzconnect/releases/latest)
下载最新版本。

| 系统 | 下载文件 | 说明 |
| --- | --- | --- |
| macOS Apple Silicon | `hkustgzconnect-1.0.1-mac-arm64.dmg` 或 `.zip` | M1/M2/M3/M4 等 |
| macOS Intel | `hkustgzconnect-1.0.1-mac-x64.dmg` 或 `.zip` | Intel Mac |
| Windows | `hkustgzconnect-1.0.1-win-x64.exe` | Windows 10/11 x64 |

Release 同时提供 `SHA256SUMS-macos.txt` 和 `SHA256SUMS-windows.txt`。
建议下载后核对校验值。

当前 macOS 构建如果没有 Developer ID 签名，请在 Finder 中右键应用并选择
“打开”。Windows 未签名构建可能显示 SmartScreen 提示。

## 快速使用

1. 安装并打开 HKUST(GZ) Connect。
2. 输入学校 VPN 账号和密码。密码由 macOS Keychain 或 Windows DPAPI 加密保存。
3. 点击连接，等待状态变为“已连接”。
4. 根据使用场景选择：
   - 点击“校园浏览器”：自动用 PAC 打开独立 Chrome 配置；
   - 将软件的 SOCKS5 代理设为 `127.0.0.1:1080`；
   - 复制界面中的 PAC 地址给支持 PAC 的应用；
   - 按下文配置 SSH 或 Clash/Mihomo。

`1080` 是默认端口，可以在应用设置中修改。修改后请同步更新 SSH、Clash
和其他软件中的端口。

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

生成的 PAC 会将这些域名、它们的子域名和字面量 `10.*` 地址发送到唯一的
SOCKS5 端口，其他网站保持直连。PAC 不执行 `dnsResolve()`，不会主动抢占
或重写系统 DNS。

“校园浏览器”默认加载这份 PAC。其他程序需要手动使用 PAC、SOCKS5 端口，
或通过 Clash/Mihomo 规则接入。

## 技术路径

```text
Electron 桌面界面
    -> 系统安全存储（Keychain / DPAPI）
    -> Rust 认证与会话模块
    -> EasyConnect 兼容传输层
    -> IPv4 数据包校验与分帧
    -> 用户态 TCP/UDP 网络栈
    -> 127.0.0.1 上唯一的 SOCKS5 入口
    -> PAC / Clash / SSH / 浏览器
```

协议、认证、传输、用户态网络栈、SOCKS5、PAC 和桌面生命周期分别位于独立
模块。网关升级时可以只更新受影响的适配器或传输模块。

主要特性：

- Rust 数据面和用户态 TCP/IP；
- SOCKS5 TCP CONNECT 与 UDP ASSOCIATE；
- 自动重连、连接状态和安全日志；
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
- [协议说明](independent/spec/PROTOCOL.md)
- [兼容性矩阵](independent/spec/COMPATIBILITY_MATRIX.md)

---

# English

## Overview

HKUST(GZ) Connect converts the campus EasyConnect tunnel into a SOCKS5
endpoint that listens only on the local machine. Browsers, Clash/Mihomo, SSH,
and other SOCKS5-capable applications can use that endpoint.

Version history:

- The `0.3.x` series was based on `zju-connect`.
- Starting with `1.0.0`, the project is based on authorized analysis of the
  official EasyConnect client and protocol, with a modular Rust engine.

The client does not change the operating-system DNS configuration, global
proxy, or default route. Only traffic explicitly using the local SOCKS5 port,
the generated PAC file, or Campus Browser enters the campus tunnel.

## Download

Download the latest build from
[GitHub Releases](https://github.com/heeh02/hkustgzconnect/releases/latest).

| Platform | Asset | Notes |
| --- | --- | --- |
| macOS Apple Silicon | `hkustgzconnect-1.0.1-mac-arm64.dmg` or `.zip` | M1/M2/M3/M4 |
| macOS Intel | `hkustgzconnect-1.0.1-mac-x64.dmg` or `.zip` | Intel Macs |
| Windows | `hkustgzconnect-1.0.1-win-x64.exe` | Windows 10/11 x64 |

Each release also contains `SHA256SUMS-macos.txt` and
`SHA256SUMS-windows.txt`.

If a macOS build has no Developer ID signature, right-click the application
in Finder and choose **Open**. Unsigned Windows builds may show a SmartScreen
warning.

## Quick start

1. Install and open HKUST(GZ) Connect.
2. Enter the campus VPN username and password. The password is protected by
   macOS Keychain or Windows DPAPI.
3. Click Connect and wait for the status to become Connected.
4. Choose one integration:
   - open Campus Browser, which uses the generated PAC automatically;
   - configure an application to use SOCKS5 at `127.0.0.1:1080`;
   - copy the PAC URL into an application that supports PAC;
   - configure SSH or Clash/Mihomo as shown below.

Port `1080` is the default and can be changed in Settings. Update every client
configuration after changing it.

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
to the single SOCKS5 endpoint. Other websites remain direct. The PAC never
calls `dnsResolve()` and does not replace the system DNS configuration.

Campus Browser loads this PAC automatically. Other applications must use the
PAC, the SOCKS5 endpoint, or Clash/Mihomo rules explicitly.

## Technical path

```text
Electron desktop UI
    -> OS-protected credentials (Keychain / DPAPI)
    -> Rust authentication and session modules
    -> EasyConnect-compatible transport
    -> bounded IPv4 validation and framing
    -> userspace TCP/UDP stack
    -> one SOCKS5 endpoint on 127.0.0.1
    -> PAC / Clash / SSH / browser
```

Authentication, transport, packet framing, userspace networking, SOCKS5, PAC,
and desktop lifecycle are separate modules. A gateway update should normally
change only the affected adapter or transport module.

Key features:

- Rust data plane and userspace TCP/IP;
- SOCKS5 TCP CONNECT and UDP ASSOCIATE;
- reconnect handling, status reporting, and private logs;
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
- [Protocol specification](independent/spec/PROTOCOL.md)
- [Compatibility matrix](independent/spec/COMPATIBILITY_MATRIX.md)

## License

GPL-3.0-only.
