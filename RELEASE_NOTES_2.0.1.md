# HKUST(GZ) Connect 2.0.1

HKUST(GZ) Connect 2.0.1 is a repository-ownership migration bridge. It preserves the 2.0.0
connection, Campus Browser, myPortal, MFA and workspace behavior while making future update checks
survive a GitHub Organization transfer.

## 主要更新

- 更新检查不再把可变的 GitHub `owner/repository` 当作仓库身份。
- 客户端先查询 HKUST-GZ-Connect 不变的 GitHub repository ID，再严格验证仓库 ID、名称、
  当前 owner、API URL、Web URL 和 Release 模板。
- 仓库转入 Organization 后，客户端可自动发现新 owner 的正式 Release 页面，无需放宽到
  任意 GitHub 仓库或任意外部链接。
- ID、仓库名、owner、主机、路径或 Release URL 不匹配时继续 fail-closed。
- 本补丁不修改校园网关协议、凭据/MFA 处理、路由、DNS、SOCKS、用户数据结构或 GUI。

## 安全与兼容性

- 固定 repository ID 为 GitHub 当前公开记录的 `1279507615`；仓库转移不改变该身份。
- 只接受 GitHub API 返回且与该 ID 完整一致的当前 owner 和 Release 前缀。
- 更新功能仍然只提示并打开 Release 页面，不静默下载、安装或执行文件。
- 升级保留设置、收藏、校园浏览器数据和已安全保存的凭据。

## 安装与签名说明

- macOS DMG 使用包体校验和 ad-hoc 签名，尚未 Developer ID 公证；首次启动可能需要在
  Finder 中右键应用并选择“打开”。
- Windows 安装器尚未配置 Authenticode 发布者证书，SmartScreen 可能提示未知发布者。
- GitHub Release 为每个附件公布 SHA-256 摘要，可在安装前核对完整性。

## Downloads

- macOS Apple Silicon: `hkustgzconnect-2.0.1-mac-arm64.dmg`
- macOS Intel: `hkustgzconnect-2.0.1-mac-x64.dmg`
- Windows x64: `hkustgzconnect-2.0.1-win-x64.exe`
- Linux x86_64: `hkustgzconnect-2.0.1-linux-x86_64.AppImage`

## English summary

Version 2.0.1 resolves the repository's current owner through its immutable GitHub repository ID,
validates the complete canonical API and web identity, and accepts only that repository's Release
pages. This lets update checks survive an ownership transfer without trusting arbitrary redirects or
repositories. Runtime networking, MFA, routing, persistence and GUI behavior are unchanged.
