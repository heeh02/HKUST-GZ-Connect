# HKUST(GZ) Connect 2.0.0

HKUST(GZ) Connect 2.0 brings the campus connection, myPortal services and personal shortcuts into one compact desktop workspace.

## 主要更新

- 全新校园工作台：按照 myPortal 的“我的应用”和“学生服务台”组织官方服务，宽屏双栏、窄屏卡片堆叠，并以固定高度分页展示，网站数量增加时不再无限拉长页面。
- 更完整的 myPortal 数据接入：官方目录按实时会话加载，接口不可用时保留经过审核的本地服务目录，不伪造个人数据。
- 周课表：以周视图展示课程与日程，每 24 小时自动刷新一次，同时保留手动刷新按钮。
- 收藏与分类：每个网站提供星标，可加入已有文件夹或新建文件夹；“我的分类”支持分页、整理和快速打开。
- 统一登录：连接账号可安全复用于校园门户的普通登录表单，不再重复输入用户名和密码。
- 短信 MFA：登录期间的验证页面使用受控原生子窗口，保留跨域 Cookie、`window.opener`、`postMessage` 和验证后自动关闭；短信验证码仍由用户手动输入，不会被自动填充、保存或记录。
- GUI 收束：修正侧栏图标居中、卡片截断、宽屏双栏、窄屏堆叠、分页指示、悬停与切换动效，并降低不必要的视觉层级。

## 安全与兼容性

- 校园浏览器、myPortal 数据读取和 MFA 子窗口共用同一隔离浏览器 Session；只有经过边界裁剪的展示数据进入界面。
- 普通网站弹窗仍在校园浏览器标签页中打开，只有正在进行的登录验证保留原生子窗口语义。
- 打包依赖已更新到 `fast-uri 3.1.6` 与 `@xmldom/xmldom 0.8.15`，修复发布前审计发现的 URL/主机混淆、SSRF 与 XML 序列化问题。
- 本版本支持浏览器侧 myPortal 短信 MFA；若学校未来在 VPN Gateway 本身启用新的 MFA 协议，需要单独验证并适配。
- 升级会保留现有设置、收藏、校园浏览器数据和已安全保存的凭据。

## Downloads

- macOS Apple Silicon: `hkustgzconnect-2.0.0-mac-arm64.dmg`
- macOS Intel: `hkustgzconnect-2.0.0-mac-x64.dmg`
- Windows x64: `hkustgzconnect-2.0.0-win-x64.exe`
- Linux x86_64: `hkustgzconnect-2.0.0-linux-x64.AppImage`

## English summary

Version 2.0 adds a myPortal-aligned campus workspace, responsive paginated service cards, personal favorites and folders, a weekly timetable with daily caching and manual refresh, shared portal credentials, and a managed native SMS-MFA window that preserves opener messaging without ever autofilling or storing one-time codes.
