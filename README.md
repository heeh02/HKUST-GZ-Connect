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
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

</div>

---

# 中文

## 这是什么

HKUST(GZ) Connect 用于在校外访问香港科技大学（广州）的校内网站和服务器。
它自带多标签校园浏览器，普通用户不需要安装 Clash、配置代理或修改系统 DNS：
登录后点击“打开校园网站”即可。

应用只处理校园浏览器和主动接入本地代理端口的软件，不修改系统 DNS、系统代理、
默认路由或其他浏览器的网络环境。退出后无需“修复网络”。

> 如果觉得 HKUST(GZ) Connect 好用，欢迎在 GitHub 给项目一个 ⭐ Star，谢谢支持！

## 下载

请从 [GitHub Releases](https://github.com/heeh02/hkustgzconnect/releases/latest)
下载最新版本。

| 系统 | 下载文件 | 适用设备 |
| --- | --- | --- |
| macOS Apple Silicon | `hkustgzconnect-<版本>-mac-arm64.dmg` | M1/M2/M3/M4 等 |
| macOS Intel | `hkustgzconnect-<版本>-mac-x64.dmg` | Intel Mac |
| Windows | `hkustgzconnect-<版本>-win-x64.exe` | Windows 10/11 x64 |
| Linux | `hkustgzconnect-<版本>-linux-x64.AppImage` | 主流 x86_64 桌面发行版 |

### macOS 安装

打开 dmg，把应用拖入“应用程序”。如果 macOS 提示“无法验证开发者”或应用
“已损坏”，可以：

1. 在 Finder 中右键点击应用，选择“打开”，然后再次确认；或
2. 打开“系统设置”→“隐私与安全性”，在相应提示处选择“仍要打开”。

### Windows 安装

运行下载的 exe。如果 SmartScreen 出现提示，点击“更多信息”→“仍要运行”。

### Linux 使用

```bash
chmod +x hkustgzconnect-<版本>-linux-x64.AppImage
./hkustgzconnect-<版本>-linux-x64.AppImage
```

如果系统没有启用 FUSE，可以使用：

```bash
./hkustgzconnect-<版本>-linux-x64.AppImage --appimage-extract-and-run
```

Linux 只有在系统提供 Secret Service/密钥环时才会保存密码；没有安全密钥环时，
应用会要求每次启动重新输入，不会把密码明文写入磁盘。

## 最简单的使用方法

1. 打开 HKUST(GZ) Connect。
2. 输入学校 VPN 账号和密码。
3. 点击“登录并连接”，等待状态变为“已连接”。
4. 点击“打开校园网站”。

输入框可以粘贴完整的校内网址；留空则打开学校主页。校园浏览器支持多个标签页，
常用快捷键包括：

- `⌘/Ctrl+T`：新建标签页；
- `⌘/Ctrl+W`：关闭当前标签页；
- `⌘/Ctrl+L`：定位到地址栏。

访问 HPC 等仅能由校园内部 DNS 解析的域名时，无需手动填写 DNS。应用会优先使用
学校在认证会话中下发的 DNS，并让查询只经过校园隧道，不会修改电脑的系统 DNS。

## 选择“校园隧道”还是“直连”

校园浏览器会按域名自动选择网络路径：

- **校园隧道**：校内网站、HPC、图书馆及其他校园资源；
- **直连**：Outlook、Canvas 等与学校合作但实际位于公网的服务。

如果某个网页打不开，可以点击地址栏旁的路径选择器切换。选择会立即保存在本机，
以后打开同一域名时自动沿用；在“网络规则”中还可以选择是否包含全部子域名。

例如：

- `hpc2login.hpc.hkust-gz.edu.cn` 应选择“校园隧道”；
- `outlook.office.com` 和 `hkust-gz.instructure.com` 应选择“直连”。

这些规则只影响校园浏览器和应用生成的 PAC，不改变 Safari、Chrome、Edge 或系统
网络设置。

## 管理常用网站

首页“常用网站”默认折叠显示。点击“展开全部”查看全部入口，点击“管理”可以：

- 新增网站名称、网址和说明；
- 选择“校园隧道”或“直连”；
- 编辑、删除和调整顺序。

自定义网站只保存在当前电脑，不会上传、同步到学校服务器或写入 GitHub。

## 保存校园网站密码

在 HTTPS 登录页成功登录后，校园浏览器会询问是否保存密码。只有用户明确点击
“保存”才会写入本机；修改密码、重置密码和登录失败页面不会被当成成功登录保存。

密码按网站来源分别保存，并由 macOS Keychain、Windows DPAPI 或 Linux Secret
Service 保护。地址栏旁的密码按钮可以填入或删除当前网站的凭据。项目维护者无法
读取这些密码，密码也不会进入日志或诊断信息。

## 设置与本地 SOCKS 端口

默认 SOCKS5 地址为 `127.0.0.1:1080`，端口可在设置中修改。它只监听本机，
不会向校园网或局域网开放。

普通用户保持“严格本地代理认证”关闭即可，不影响校园浏览器、Clash 或 SSH。
共享电脑若担心同一台机器上的其他程序借用校园隧道，可以开启严格认证；应用内
校园浏览器会自动处理认证。Clash 和 SSH 请使用控制塔生成的配置。

修改 SOCKS 端口后，需要同步更新外部软件中的端口，或重新复制一次 Clash 节点。

## Clash / Mihomo

访问校内网站不需要 Clash。只有需要让其他应用按规则进入校园隧道时才需要配置。

1. 先连接 HKUST(GZ) Connect。
2. 在“控制塔”点击“复制 Clash 节点”。
3. 把复制出的节点粘贴到 Clash、Clash Verge Rev 或 Mihomo 配置。
4. 把需要进入校园网的规则指向 `HKUSTGZ`，并放在 `MATCH`、`GEOIP` 等兜底规则前。

示例结构如下，实际用户名和密码请使用应用复制出的值：

```yaml
proxies:
  - name: HKUSTGZ
    type: socks5
    server: 127.0.0.1
    port: 1080
    username: <使用应用复制出的值>
    password: <使用应用复制出的值>
    udp: false

rules:
  - DOMAIN-SUFFIX,hkust-gz.edu.cn,HKUSTGZ
  - DOMAIN-SUFFIX,hkust.edu.hk,HKUSTGZ
  - IP-CIDR,10.0.0.0/8,HKUSTGZ,no-resolve
```

建议使用 Clash 规则模式，不需要为本项目开启 TUN，也不需要改写系统 DNS。普通
重连、重启或切换严格认证无需更新节点；只有修改本地 SOCKS 端口后需要重新复制。

## SSH

HKUST(GZ) Connect 不创建系统级虚拟网卡，因此 SSH 需要通过 `ProxyCommand`
明确使用本地 SOCKS 端口。

最简单的方法是在“控制塔”点击“复制 SSH 配置”，再把生成的 `ProxyCommand`
粘贴到 `~/.ssh/config` 的目标主机配置中：

```sshconfig
Host hkustgz-hpc
    HostName 10.120.48.30
    User <你的校园用户名>
    # 在这里粘贴应用生成的 ProxyCommand
```

然后照常连接：

```bash
ssh hkustgz-hpc
```

应用随包提供的 helper 同时兼容普通模式和严格认证。认证信息不会出现在 SSH 配置、
命令行或日志中；普通重连和应用重启无需重新配置。

## PAC 与域名规则

需要让支持 PAC 的外部软件自动分流时，可以在设置中维护校园域名，例如：

```text
hkust-gz.edu.cn
hkust.edu.hk
example.internal
```

生成的 PAC 会把这些域名、子域名和字面量 `10.*` 地址交给本地 SOCKS5，其他网站
保持直连。PAC 不调用 `dnsResolve()`，不会抢占或重写系统 DNS。

PAC 文件不能携带代理认证信息。开启严格认证后，建议使用校园浏览器，或使用应用
生成的 Clash/SSH 配置。

## 常见问题

- **连接后普通上网会变慢吗？** 不会。只有校园浏览器和明确配置了本地代理的应用
  会进入校园隧道。
- **需要安装 Chrome 或 Clash 吗？** 不需要。校园浏览器已经包含在应用中，Clash
  只是高级可选项。
- **会修改或抢占系统 DNS 吗？** 不会。校园内部 DNS 查询只在用户态校园隧道内
  完成。
- **退出后需要恢复网络吗？** 不需要，应用没有修改系统代理、默认路由或 DNS。
- **连接成功但网站打不开怎么办？** 先确认网址完整且路径选择正确。校内网站选择
  “校园隧道”，Outlook、Canvas 等公网合作服务选择“直连”，然后重新加载。
- **HPC 域名提示 DNS 失败怎么办？** 先断开并重新连接，让应用重新取得学校 DNS；
  若仍失败，请从“通知”复制脱敏日志并联系维护人员，不要把账号或密码发给他人。
- **端口被占用怎么办？** 在设置中换一个未使用端口，保存并重连，然后更新外部
  Clash/SSH 配置。
- **日志会一直增长吗？** 不会。日志最多保留 3 天，同时有文件大小上限和轮转。

## 隐私说明

- VPN 密码和校园网站密码只保存在用户自己的电脑上；
- 密码、Cookie、token 和完整认证响应不会写入日志；
- 日志默认脱敏，并受 3 天保留期限和文件大小限制；
- 自定义网站、域名规则和浏览记录不会同步给项目维护者；
- SOCKS 端口始终只绑定 `127.0.0.1`；
- 应用不会修改系统 DNS、系统代理、默认路由或其他浏览器配置。

---

# English

## What it does

HKUST(GZ) Connect provides off-campus access to HKUST(GZ) campus websites and
servers. It includes a multi-tab Campus Browser, so ordinary users do not need
Clash, manual proxy settings, or system DNS changes: connect and click
**Open Campus Website**.

Only Campus Browser and applications explicitly configured to use the local
proxy endpoint are affected. The app does not change system DNS, the global
proxy, the default route, or the network behavior of other browsers.

> If HKUST(GZ) Connect is useful, please consider giving the project a ⭐ Star
> on GitHub. Thank you!

## Download

Download the latest build from
[GitHub Releases](https://github.com/heeh02/hkustgzconnect/releases/latest).

| Platform | Asset | Devices |
| --- | --- | --- |
| macOS Apple Silicon | `hkustgzconnect-<version>-mac-arm64.dmg` | M1/M2/M3/M4 |
| macOS Intel | `hkustgzconnect-<version>-mac-x64.dmg` | Intel Macs |
| Windows | `hkustgzconnect-<version>-win-x64.exe` | Windows 10/11 x64 |
| Linux | `hkustgzconnect-<version>-linux-x64.AppImage` | Mainstream x86_64 desktops |

### macOS

Open the dmg and drag the app into Applications. If macOS says the developer
cannot be verified or the app is damaged:

1. Right-click the app in Finder, choose **Open**, and confirm; or
2. Open **System Settings → Privacy & Security** and choose **Open Anyway**.

### Windows

Run the downloaded exe. If SmartScreen appears, choose **More info → Run
anyway**.

### Linux

```bash
chmod +x hkustgzconnect-<version>-linux-x64.AppImage
./hkustgzconnect-<version>-linux-x64.AppImage
```

Without FUSE, use `--appimage-extract-and-run`. Linux saves passwords only when
a Secret Service/keyring backend is available; otherwise the password must be
entered on each start and is never persisted as plaintext.

## Easiest setup

1. Open HKUST(GZ) Connect.
2. Enter the campus VPN username and password.
3. Click **Sign in and connect** and wait for **Connected**.
4. Click **Open Campus Website**.

Paste a complete campus URL into the field, or leave it empty to open the
university home page. Campus Browser supports multiple tabs and these shortcuts:

- `Cmd/Ctrl+T`: new tab;
- `Cmd/Ctrl+W`: close the current tab;
- `Cmd/Ctrl+L`: focus the address bar.

Campus-only names such as HPC hosts need no manual DNS setup. The app prefers
DNS supplied by the authenticated school session and sends those queries only
through the campus tunnel without changing operating-system DNS.

## Campus tunnel or Direct

Campus Browser chooses a route per domain:

- **Campus tunnel** for internal websites, HPC, the library, and other campus
  resources;
- **Direct** for public partner services such as Outlook and Canvas.

If a page does not open, use the route selector beside the address bar. The
choice is saved immediately on this computer and reused for that domain. The
Network Rules manager can optionally include every subdomain.

Examples:

- `hpc2login.hpc.hkust-gz.edu.cn` should use **Campus tunnel**;
- `outlook.office.com` and `hkust-gz.instructure.com` should use **Direct**.

These rules affect Campus Browser and the generated PAC only. They do not
change Safari, Chrome, Edge, or system network settings.

## Common websites

The Common Websites shelf is collapsed by default. Use **Show all** to expand
it and **Manage** to:

- add a name, URL, and description;
- choose Campus tunnel or Direct;
- edit, delete, and reorder shortcuts.

Custom shortcuts stay on this computer and are not uploaded or synchronized.

## Saving website passwords

After a successful HTTPS login, Campus Browser can ask whether to save the
credential. Nothing is stored unless the user explicitly chooses **Save**.
Password-change, reset, and failed-login forms are excluded.

Credentials are isolated per website origin and protected by macOS Keychain,
Windows DPAPI, or Linux Secret Service. The password button beside the address
bar can fill or remove the credential for the current site. Passwords never
enter logs or diagnostic information and cannot be read by the maintainer.

## Settings and local SOCKS endpoint

The default SOCKS5 endpoint is `127.0.0.1:1080`; its port can be changed in
Settings. It listens only on the local computer and is never exposed to the LAN.

Ordinary users should leave **Strict local proxy authentication** off. Campus
Browser, Clash, and SSH work normally in this default mode. On a shared computer,
strict authentication can prevent another local program from borrowing the
campus session. Campus Browser handles it automatically; use the configurations
generated by Control Tower for Clash and SSH.

After changing the SOCKS port, update external applications or copy the Clash
node again.

## Clash / Mihomo

Clash is not required for campus websites. Configure it only when another
application needs rule-based access to the campus tunnel.

1. Connect HKUST(GZ) Connect.
2. Click **Copy Clash Node** in Control Tower.
3. Paste the node into Clash, Clash Verge Rev, or Mihomo.
4. Point campus rules at `HKUSTGZ` and keep them before `MATCH`, `GEOIP`, and
   other catch-all rules.

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
```

Rule mode is recommended. TUN mode and system DNS rewriting are unnecessary.
Reconnects, app restarts, and strict-mode changes do not require a new node;
copy it again only after changing the SOCKS port.

## SSH

Because the app does not create a system-wide virtual interface, SSH needs an
explicit `ProxyCommand` for the local SOCKS endpoint.

Click **Copy SSH Config** in Control Tower and paste the generated
`ProxyCommand` into the target host block in `~/.ssh/config`:

```sshconfig
Host hkustgz-hpc
    HostName 10.120.48.30
    User <campus-username>
    # Paste the ProxyCommand generated by the app here.
```

Then connect normally:

```bash
ssh hkustgz-hpc
```

The bundled helper supports both compatibility and strict authentication.
Authentication data does not appear in SSH config, process arguments, or logs,
and ordinary reconnects do not require another configuration change.

## PAC and domain rules

Applications that support PAC can use a campus-domain list such as:

```text
hkust-gz.edu.cn
hkust.edu.hk
example.internal
```

The generated PAC sends those domains, their subdomains, and literal `10.*`
addresses to the local SOCKS5 endpoint while other websites remain direct. It
does not call `dnsResolve()` or replace system DNS.

A PAC file cannot carry proxy credentials. In strict mode, use Campus Browser
or the authenticated Clash/SSH configuration generated by Control Tower.

## FAQ

- **Will ordinary browsing become slower?** No. Only Campus Browser and apps
  explicitly configured for the local endpoint use the tunnel.
- **Are Chrome or Clash required?** No. Campus Browser is included; Clash is an
  optional advanced integration.
- **Does the app take over system DNS?** No. Internal DNS queries stay inside
  the userspace campus tunnel.
- **Must the network be repaired after quitting?** No system proxy, route, or
  DNS setting was changed.
- **Connected, but a page does not open?** Verify the full URL and route. Use
  Campus tunnel for internal sites and Direct for Outlook, Canvas, and other
  public partner services, then reload.
- **HPC reports a DNS failure?** Disconnect and reconnect once so the app can
  obtain the school DNS policy again. If it still fails, copy the redacted log
  from Notifications and contact support; never send anyone your password.
- **The port is already in use?** Choose another port in Settings, reconnect,
  and update Clash or SSH.
- **Do logs grow forever?** No. Logs have a three-day retention period, file
  size limits, and one rotated file.

## Privacy

- VPN and website passwords remain on the user's computer;
- passwords, cookies, tokens, and full authentication responses are not logged;
- redacted logs have a three-day retention period and strict size limits;
- shortcuts, routing rules, and browsing records are not synchronized with the
  maintainer;
- the SOCKS endpoint binds only to `127.0.0.1`;
- the app does not modify system DNS, the global proxy, the default route, or
  other browser settings.

## License

GPL-3.0-only.
