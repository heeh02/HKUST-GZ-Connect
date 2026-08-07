// Renderer UI strings, shared by the control panel (index.html + app.js) and
// the campus-browser chrome (campus-browser.html + campus-browser.js).
// UMD-lite: window.I18N in the page, module.exports under node:test.
// Chinese is the default locale and the per-key fallback.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.I18N = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const dictionaries = {
    zh: {
      'brand.sub': '香港科技大学(广州) · 校园 VPN',

      'login.account': '账号',
      'login.accountPlaceholder': '校园账号前缀(如 xxx000)',
      'login.password': '密码',
      'login.passwordPlaceholder': '校园密码',
      'login.submit': '登录并连接',
      'login.help': '只访问校内网站无需安装 Clash，也不会修改系统 DNS。',
      'login.connecting': '正在连接…',
      'login.needAccount': '请填写账号',
      'login.needPassword': '请填写密码',
      'login.passwordSaveFailed': '密码保存失败',
      'login.connectFailed': '连接失败，请重试',

      'nav.connect': '连接',
      'nav.tower': '控制塔',
      'nav.notif': '通知',
      'nav.notifTitle': '通知 / 日志',
      'nav.settings': '设置',

      'connect.location': '香港科技大学(广州)',
      'connect.powerLabel': '连接开关',
      'connect.disconnected': '未连接',
      'connect.connecting': '连接中…',
      'connect.connected': '已连接',

      'quick.title': '打开校园网站',
      'quick.sub': '应用内多标签浏览器，无需 Clash，不影响其他软件上网',
      'quick.badge': '推荐',
      'quick.urlPlaceholder': '可选：粘贴校内网址；留空打开学校主页',
      'quick.open': '打开校园网站',
      'quick.connectOpen': '连接并打开校园网站',
      'quick.opening': '正在打开…',
      'quick.connectThenOpen': '正在连接，完成后自动打开…',
      'quick.addOpen': '添加到常用并打开',
      'quick.needUrl': '请先粘贴需要保存的网址',
      'quick.addFailed': '添加网站失败',
      'quick.browserOpenFailed': '校园浏览器打开失败',

      'resources.title': '常用网站',
      'resources.gridLabel': '常用校园服务',
      'resources.expandAll': '展开全部',
      'resources.collapse': '收起',
      'resources.manage': '管理',
      'resources.saved': '已添加到常用网站',
      'resources.changesSaved': '已保存修改',
      'resources.routeCampus': '校园隧道',
      'resources.routeDirect': '直连',

      'stats.duration': '时长',
      'stats.latency': '网关延迟',
      'stats.connections': '活动连接',
      'stats.campusIp': '校内 IP',
      'stats.appsTitle': '正在使用隧道的程序',
      'stats.appsEmpty': '暂无程序在用隧道(浏览器走 PAC 或 ssh 后显示)',
      'stats.connectionCount': '{count} 连接',

      'section.details': '连接详情',
      'section.expand': '展开',
      'section.collapse': '收起',

      'gateway.label': '校园网关',
      'gateway.sub': '广州 · HKUST(GZ) 校园网',

      'tower.title': '控制塔',
      'tower.connectionPort': '连接与端口',
      'tower.socksPort': '本地 SOCKS 端口',
      'tower.autoReconnect': '自动重连',
      'tower.maxAttempts': '重试次数',
      'tower.startAtLogin': '开机自启',
      'tower.autoConnect': '启动后自动连接',
      'tower.portHint': '普通用户无需配置端口。高级软件可使用本机 SOCKS5；应用不会修改系统 DNS、默认路由或全局代理。',
      'tower.routeDomains': '默认分流网站',
      'tower.routeDomainsPlaceholder': '每行一个域名，例如 hkust-gz.edu.cn',
      'tower.routeDomainsHint': '此列表只用于外部应用的 PAC 分流。应用内校园浏览器会把自身流量隔离地送入隧道，不依赖该列表。',
      'tower.advanced': '高级接入与工具',
      'tower.socksProxy': 'SOCKS5 代理',
      'tower.copy': '复制',
      'tower.copyPac': '复制 PAC 地址',
      'tower.copySsh': '复制 SSH 命令',
      'tower.openBrowser': '打开应用内校园浏览器',
      'tower.openLog': '打开日志',
      'tower.save': '保存',
      'tower.saveReconnect': '保存并重连',
      'tower.saved': '已保存 ✓',
      'tower.savedApplied': '已保存并应用 ✓',
      'tower.reconnecting': '重连中…',
      'tower.savedReconnected': '已保存并重连 ✓',
      'tower.saveFailed': '保存失败，请重试',
      'tower.portInvalid': '端口必须是 1025–65535 的整数',
      'tower.attemptsInvalid': '重试次数必须是 0–10 的整数',
      'tower.copied': '已复制',

      'notif.title': '通知 / 日志',
      'notif.refresh': '刷新',
      'notif.empty': '(暂无日志,连接后这里显示运行/错误信息)',

      'settings.title': '设置',
      'settings.account': '当前账号',
      'settings.gateway': '网关',
      'settings.gatewayHint': '网关及协议参数由受版本控制的引擎配置提供，避免本机设置漂移。',
      'settings.windowBehavior': '窗口行为',
      'settings.closeAction': '点击关闭按钮时',
      'settings.closeAsk': '每次询问',
      'settings.closeMinimize': '最小化到托盘',
      'settings.closeQuit': '直接退出程序',
      'settings.logout': '退出登录 / 切换账号',
      'settings.openFullLog': '打开完整日志',
      'settings.checkUpdate': '检查更新',
      'settings.updateAvailable': '发现新版本 <strong>v{version}</strong> <button id="updateDownload" class="mini" type="button">{button}</button>',
      'settings.updateDownload': '前往下载',
      'settings.updateLatest': '已是最新 ✓',
      'settings.updateFailed': '检查失败，请稍后重试',

      'dialog.title': '管理常用网站',
      'dialog.sub': '快捷方式只保存在这台电脑上。',
      'dialog.close': '关闭',
      'dialog.name': '名称',
      'dialog.namePlaceholder': '留空时自动使用网址',
      'dialog.url': '网址',
      'dialog.description': '说明',
      'dialog.route': '网络路径',
      'dialog.add': '添加网站',
      'dialog.saveChanges': '保存修改',
      'dialog.clear': '清空',
      'dialog.cancelEdit': '取消编辑',
      'dialog.editing': '正在编辑：{name}',
      'dialog.builtin': '内置',
      'dialog.builtinReadonly': '内置网站不能覆盖，请新增一个自定义入口',
      'dialog.edit': '编辑',
      'dialog.moveUp': '上移',
      'dialog.moveDown': '下移',
      'dialog.delete': '删除',
      'dialog.confirmDelete': '确认删除',
      'dialog.cancelDelete': '取消删除',
      'dialog.deleteFailed': '删除失败',
      'dialog.saveFailed': '保存失败',

      // campus-browser chrome
      'browser.title': 'HKUST(GZ) 校园浏览器',
      'browser.tabs': '网页标签',
      'browser.newTab': '新建标签页',
      'browser.newTabShortcut': '新建标签页 (⌘T)',
      'browser.newTabFallback': '新标签页',
      'browser.closeTab': '关闭标签页',
      'browser.back': '后退',
      'browser.forward': '前进',
      'browser.reload': '重新加载',
      'browser.credentialTitle': '此网站保存的密码',
      'browser.credentialLabel': '管理此网站保存的密码',
      'browser.addressLabel': '校园网站地址',
      'browser.addressPlaceholder': '输入校园网站地址',
      'browser.routeLabel': '此标签的网络路径',
      'browser.routeTitle': '选择此标签的网络路径',
      'browser.routeCampus': '校园隧道',
      'browser.routeDirect': '直连',
      'browser.stateDefault': '校园网络',
      'browser.loading': '正在加载…',
      'browser.loadingSlow': '加载较慢，可尝试切换网络路径',
      'browser.viaCampus': '此标签通过 HKUST(GZ) Connect',
      'browser.viaDirect': '此标签直接连接互联网',
      'browser.badgeCampus': '校',
      'browser.badgeDirect': '直',
      'browser.findLabel': '在页面中查找',
      'browser.findPlaceholder': '在页面中查找',
      'browser.findPrev': '上一个 (⇧+回车)',
      'browser.findPrevLabel': '上一个匹配',
      'browser.findNext': '下一个 (回车)',
      'browser.findNextLabel': '下一个匹配',
      'browser.findClose': '关闭 (Esc)',
      'browser.findCloseLabel': '关闭查找栏',
    },
    en: {
      'brand.sub': 'HKUST(GZ) · Campus VPN',

      'login.account': 'Account',
      'login.accountPlaceholder': 'Campus account prefix (e.g. xxx000)',
      'login.password': 'Password',
      'login.passwordPlaceholder': 'Campus password',
      'login.submit': 'Sign In & Connect',
      'login.help': 'Campus sites only — no Clash needed and system DNS is untouched.',
      'login.connecting': 'Connecting…',
      'login.needAccount': 'Please enter your account',
      'login.needPassword': 'Please enter your password',
      'login.passwordSaveFailed': 'Failed to save the password',
      'login.connectFailed': 'Connection failed, please retry',

      'nav.connect': 'Connect',
      'nav.tower': 'Control Tower',
      'nav.notif': 'Alerts',
      'nav.notifTitle': 'Notifications / Logs',
      'nav.settings': 'Settings',

      'connect.location': 'HKUST (Guangzhou)',
      'connect.powerLabel': 'Connection switch',
      'connect.disconnected': 'Disconnected',
      'connect.connecting': 'Connecting…',
      'connect.connected': 'Connected',

      'quick.title': 'Open Campus Sites',
      'quick.sub': 'Built-in tabbed browser — no Clash needed, other apps are unaffected',
      'quick.badge': 'Recommended',
      'quick.urlPlaceholder': 'Optional: paste a campus URL; empty opens the school homepage',
      'quick.open': 'Open Campus Site',
      'quick.connectOpen': 'Connect & Open',
      'quick.opening': 'Opening…',
      'quick.connectThenOpen': 'Connecting; will open when ready…',
      'quick.addOpen': 'Save & Open',
      'quick.needUrl': 'Paste the URL to save first',
      'quick.addFailed': 'Failed to add the site',
      'quick.browserOpenFailed': 'Failed to open the campus browser',

      'resources.title': 'Favorite Sites',
      'resources.gridLabel': 'Favorite campus services',
      'resources.expandAll': 'Show All',
      'resources.collapse': 'Collapse',
      'resources.manage': 'Manage',
      'resources.saved': 'Added to favorite sites',
      'resources.changesSaved': 'Changes saved',
      'resources.routeCampus': 'Campus tunnel',
      'resources.routeDirect': 'Direct',

      'stats.duration': 'Duration',
      'stats.latency': 'Gateway Latency',
      'stats.connections': 'Active Conns',
      'stats.campusIp': 'Campus IP',
      'stats.appsTitle': 'Apps Using the Tunnel',
      'stats.appsEmpty': 'No apps are using the tunnel (shown after a browser uses PAC or ssh)',
      'stats.connectionCount': '{count} connections',

      'section.details': 'Connection Details',
      'section.expand': 'Expand',
      'section.collapse': 'Collapse',

      'gateway.label': 'Campus Gateway',
      'gateway.sub': 'Guangzhou · HKUST(GZ) Campus Network',

      'tower.title': 'Control Tower',
      'tower.connectionPort': 'Connection & Port',
      'tower.socksPort': 'Local SOCKS Port',
      'tower.autoReconnect': 'Auto-Reconnect',
      'tower.maxAttempts': 'Retry Attempts',
      'tower.startAtLogin': 'Launch at Login',
      'tower.autoConnect': 'Connect on Launch',
      'tower.portHint': 'Most users don’t need to configure the port. Advanced apps can use the local SOCKS5 proxy; the app never changes system DNS, the default route, or the global proxy.',
      'tower.routeDomains': 'Default Split-Routing Sites',
      'tower.routeDomainsPlaceholder': 'One domain per line, e.g. hkust-gz.edu.cn',
      'tower.routeDomainsHint': 'This list is only for PAC split routing of external apps. The built-in campus browser tunnels its own traffic in isolation and does not rely on it.',
      'tower.advanced': 'Advanced Access & Tools',
      'tower.socksProxy': 'SOCKS5 Proxy',
      'tower.copy': 'Copy',
      'tower.copyPac': 'Copy PAC URL',
      'tower.copySsh': 'Copy SSH Command',
      'tower.openBrowser': 'Open Built-in Campus Browser',
      'tower.openLog': 'Open Logs',
      'tower.save': 'Save',
      'tower.saveReconnect': 'Save & Reconnect',
      'tower.saved': 'Saved ✓',
      'tower.savedApplied': 'Saved & applied ✓',
      'tower.reconnecting': 'Reconnecting…',
      'tower.savedReconnected': 'Saved & reconnected ✓',
      'tower.saveFailed': 'Save failed, please retry',
      'tower.portInvalid': 'Port must be an integer between 1025 and 65535',
      'tower.attemptsInvalid': 'Retry attempts must be an integer between 0 and 10',
      'tower.copied': 'Copied',

      'notif.title': 'Notifications / Logs',
      'notif.refresh': 'Refresh',
      'notif.empty': '(No logs yet; runtime/error info appears here after connecting)',

      'settings.title': 'Settings',
      'settings.account': 'Current Account',
      'settings.gateway': 'Gateway',
      'settings.gatewayHint': 'Gateway and protocol parameters come from the version-controlled engine config to prevent local settings drift.',
      'settings.windowBehavior': 'Window Behavior',
      'settings.closeAction': 'When the close button is clicked',
      'settings.closeAsk': 'Ask every time',
      'settings.closeMinimize': 'Minimize to Tray',
      'settings.closeQuit': 'Quit directly',
      'settings.logout': 'Sign Out / Switch Account',
      'settings.openFullLog': 'Open Full Log',
      'settings.checkUpdate': 'Check for Updates',
      'settings.updateAvailable': 'New version <strong>v{version}</strong> available <button id="updateDownload" class="mini" type="button">{button}</button>',
      'settings.updateDownload': 'Download',
      'settings.updateLatest': 'Up to date ✓',
      'settings.updateFailed': 'Check failed, please try again later',

      'dialog.title': 'Manage Favorite Sites',
      'dialog.sub': 'Shortcuts are stored only on this computer.',
      'dialog.close': 'Close',
      'dialog.name': 'Name',
      'dialog.namePlaceholder': 'Uses the URL when left empty',
      'dialog.url': 'URL',
      'dialog.description': 'Description',
      'dialog.route': 'Network Route',
      'dialog.add': 'Add Site',
      'dialog.saveChanges': 'Save Changes',
      'dialog.clear': 'Clear',
      'dialog.cancelEdit': 'Cancel Edit',
      'dialog.editing': 'Editing: {name}',
      'dialog.builtin': 'Built-in',
      'dialog.builtinReadonly': 'Built-in sites can’t be overwritten; add a custom entry instead',
      'dialog.edit': 'Edit',
      'dialog.moveUp': 'Move Up',
      'dialog.moveDown': 'Move Down',
      'dialog.delete': 'Delete',
      'dialog.confirmDelete': 'Confirm Delete',
      'dialog.cancelDelete': 'Cancel',
      'dialog.deleteFailed': 'Delete failed',
      'dialog.saveFailed': 'Save failed',

      // campus-browser chrome
      'browser.title': 'HKUST(GZ) Campus Browser',
      'browser.tabs': 'Tabs',
      'browser.newTab': 'New Tab',
      'browser.newTabShortcut': 'New Tab (⌘T)',
      'browser.newTabFallback': 'New Tab',
      'browser.closeTab': 'Close Tab',
      'browser.back': 'Back',
      'browser.forward': 'Forward',
      'browser.reload': 'Reload',
      'browser.credentialTitle': 'Passwords saved for this site',
      'browser.credentialLabel': 'Manage passwords saved for this site',
      'browser.addressLabel': 'Campus site address',
      'browser.addressPlaceholder': 'Enter a campus URL',
      'browser.routeLabel': 'Network route for this tab',
      'browser.routeTitle': 'Choose the network route for this tab',
      'browser.routeCampus': 'Campus tunnel',
      'browser.routeDirect': 'Direct',
      'browser.stateDefault': 'Campus Network',
      'browser.loading': 'Loading…',
      'browser.loadingSlow': 'Slow — try switching route',
      'browser.viaCampus': 'This tab connects via HKUST(GZ) Connect',
      'browser.viaDirect': 'This tab connects directly to the internet',
      'browser.badgeCampus': 'C',
      'browser.badgeDirect': 'D',
      'browser.findLabel': 'Find in page',
      'browser.findPlaceholder': 'Find in page',
      'browser.findPrev': 'Previous (⇧+Enter)',
      'browser.findPrevLabel': 'Previous match',
      'browser.findNext': 'Next (Enter)',
      'browser.findNextLabel': 'Next match',
      'browser.findClose': 'Close (Esc)',
      'browser.findCloseLabel': 'Close find bar',
    },
  };

  function resolveLocale(rawLocale) {
    const value = String(rawLocale || '').trim().toLowerCase();
    if (!value || value.startsWith('zh')) return 'zh';
    return 'en';
  }

  function interpolate(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (match, name) => (
      vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
    ));
  }

  function createT(locale) {
    const dict = dictionaries[locale] || dictionaries.zh;
    return (key, vars) => {
      const template = dict[key] ?? dictionaries.zh[key];
      return template === undefined ? key : interpolate(template, vars);
    };
  }

  // Static markup opts in with data-i18n="key" (textContent) and
  // data-i18n-attr="placeholder:some.key; title:other.key" (attributes).
  function applyStatic(t, doc) {
    for (const el of doc.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.getAttribute('data-i18n'));
    }
    for (const el of doc.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of el.getAttribute('data-i18n-attr').split(';')) {
        const [attr, key] = pair.split(':').map((part) => part.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    }
  }

  return { applyStatic, createT, dictionaries, resolveLocale };
});
