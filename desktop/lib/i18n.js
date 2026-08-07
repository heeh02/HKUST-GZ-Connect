'use strict';

// Main-process UI strings. The renderer has its own copy in
// renderer/i18n.js (it cannot require from lib/ under the page CSP).
// Chinese is the default locale and the per-key fallback, so a missing
// English entry can never blank out the UI.

const dictionaries = {
  zh: {
    'status.disconnected': '未连接',
    'status.connecting': '连接中',
    'status.connected': '已连接',
    'status.ipAssigned': '已分配',

    'tray.showWindow': '显示主窗口',
    'tray.status': '状态：{status}',
    'tray.connect': '连接',
    'tray.disconnect': '断开连接',
    'tray.openCampusBrowser': '打开校园浏览器',
    'tray.quit': '退出程序',

    'close.title': '关闭 HKUST(GZ) Connect',
    'close.message': '关闭窗口时要执行什么操作？',
    'close.detail': '最小化到托盘会保持校园网络连接。',
    'close.minimize': '最小化到托盘',
    'close.quit': '退出程序',
    'close.cancel': '取消',
    'close.remember': '记住我的选择（可在设置中更改）',

    'menu.about': '关于 HKUST(GZ) Connect',
    'menu.hide': '隐藏 HKUST(GZ) Connect',
    'menu.hideOthers': '隐藏其他应用',
    'menu.unhide': '全部显示',
    'menu.quit': '退出 HKUST(GZ) Connect',
    'menu.edit': '编辑',
    'menu.undo': '撤销',
    'menu.redo': '重做',
    'menu.cut': '剪切',
    'menu.copy': '复制',
    'menu.paste': '粘贴',
    'menu.selectAll': '全选',
    'menu.window': '窗口',
    'menu.minimize': '最小化',
    'menu.closeWindow': '关闭窗口',

    'error.needCredentials': '请先填写账号和密码',
    'error.engineMissing': '引擎缺失:{path}',
    'error.engineConfigMissing': '引擎配置缺失:{path}',
    'error.engineStart': '无法启动引擎:{message}',
    'error.reconnecting': '连接中断,正在自动重连…',
    'error.gatewayRetrying': '网关暂未分配校园网地址，正在清理会话并自动重试…',
    'error.gatewayRejected': '校园网关暂时拒绝数据通道，已停止重试；请等待一分钟后再连接',
    'error.reconnectFailed': '连接已断开,自动重连多次失败,请手动重连或查看日志',
    'error.connectFailed': '连接失败,请重试或查看日志',
    'error.engineStuck': '引擎未能停止，请退出程序后重试',
    'error.tunnelRecovering': '校园隧道无响应，正在自动恢复…',
    'error.pacWriteAfterSave': '设置已保存，但 PAC 文件写入失败：{message}',
    'error.passwordStoreUnavailable': '系统安全存储不可用，密码未保存',
    'error.connectTimeout': '连接校园网络超时，请重试或查看日志',
    'error.browserStart': '校园浏览器启动失败：{message}',
    'error.pacWriteAtBoot': '无法写入 PAC 文件：{message}',
    'error.startupTitle': 'HKUST(GZ) Connect 启动失败',

    'engine.authFailed': '登录失败：账号或密码错误，已停止自动重试',
    'engine.authUnsupported': '网关鉴权方式不受支持（可能已改为 SSO/MFA）',
    'engine.portBusy': '端口 {port} 被占用，请在控制塔更换端口',
    'engine.channelClosed': '校园网关通道暂时关闭，正在清理会话并自动重试…',

    'url.tooLong': '网址过长',
    'url.invalid': '网址格式不正确',
    'url.schemeUnsupported': '校园浏览器只支持 HTTP 和 HTTPS 网址',

    'route.campus': '校园隧道',
    'route.direct': '直连',
    'route.switchFailed': '切换网络路径失败：{message}',

    'tab.new': '新标签页',
    'browser.windowTitle': 'HKUST(GZ) 校园浏览器',

    'cert.unknown': '未知',
    'cert.site': '网站：{origin}',
    'cert.chromiumError': 'Chromium 错误：{error}',
    'cert.subject': '主题：{subject}',
    'cert.issuer': '颁发者：{issuer}',
    'cert.validity': '有效期：{start} 至 {end}',
    'cert.fingerprint': '证书 SHA-256：{fingerprint}',
    'cert.scope': '只会为这个精确的网站来源保存指纹；相同域名的其他端口、子域名和其他网站不会继承此信任。',
    'cert.title': '需要确认网站证书',
    'cert.message': '是否仅为 {origin} 信任这张证书？',
    'cert.trust': '信任此网站证书',

    'common.cancel': '取消',

    'download.interrupted': '下载未完成：{filename}',
    'download.noLocation': '无法选择下载保存位置',

    'cred.saveTitle': '保存校园网站密码',
    'cred.saveMessage': '要为 {host} 保存此登录信息吗？',
    'cred.saveDetail': '保存副本只加密存放在这台电脑上，不会额外上传给维护者或 GitHub。',
    'cred.save': '保存',
    'cred.later': '暂不保存',
    'cred.writeFailed': '网站密码无法写入本机安全存储',
    'cred.httpsOnly': '网站密码只适用于 HTTPS 页面',
    'cred.title': '网站密码',
    'cred.noneMessage': '{host} 尚未保存密码',
    'cred.noneDetail': '在网站登录表单提交后，校园浏览器会询问是否保存在本机。',
    'cred.ok': '知道了',
    'cred.hasMessage': '{host} 已保存一个登录账号',
    'cred.hasDetail': '可以填入当前登录页，或只删除这个网站保存在本机的凭据。',
    'cred.fill': '填入登录页',
    'cred.delete': '删除保存',
    'cred.readFailed': '网站密码无法从本机安全存储读取',

    'errorPage.title': '校园网站无法打开',
    'errorPage.heading': '这个校园网站暂时无法打开',
    'errorPage.body': '请确认 HKUST(GZ) Connect 仍为“已连接”，也可以检查网址后点击上方的重新加载。',
    'errorPage.unknownUrl': '未知网址',
    'errorPage.networkFailed': '网络请求失败',
  },
  en: {
    'status.disconnected': 'Disconnected',
    'status.connecting': 'Connecting',
    'status.connected': 'Connected',
    'status.ipAssigned': 'Assigned',

    'tray.showWindow': 'Show Window',
    'tray.status': 'Status: {status}',
    'tray.connect': 'Connect',
    'tray.disconnect': 'Disconnect',
    'tray.openCampusBrowser': 'Open Campus Browser',
    'tray.quit': 'Quit',

    'close.title': 'Close HKUST(GZ) Connect',
    'close.message': 'What should happen when the window closes?',
    'close.detail': 'Minimizing to the tray keeps the campus network connected.',
    'close.minimize': 'Minimize to Tray',
    'close.quit': 'Quit',
    'close.cancel': 'Cancel',
    'close.remember': 'Remember my choice (can be changed in Settings)',

    'menu.about': 'About HKUST(GZ) Connect',
    'menu.hide': 'Hide HKUST(GZ) Connect',
    'menu.hideOthers': 'Hide Others',
    'menu.unhide': 'Show All',
    'menu.quit': 'Quit HKUST(GZ) Connect',
    'menu.edit': 'Edit',
    'menu.undo': 'Undo',
    'menu.redo': 'Redo',
    'menu.cut': 'Cut',
    'menu.copy': 'Copy',
    'menu.paste': 'Paste',
    'menu.selectAll': 'Select All',
    'menu.window': 'Window',
    'menu.minimize': 'Minimize',
    'menu.closeWindow': 'Close Window',

    'error.needCredentials': 'Please enter your account and password first',
    'error.engineMissing': 'Engine missing: {path}',
    'error.engineConfigMissing': 'Engine config missing: {path}',
    'error.engineStart': 'Could not start the engine: {message}',
    'error.reconnecting': 'Connection lost, reconnecting…',
    'error.gatewayRetrying': 'The gateway has not assigned a campus address yet; cleaning up the session and retrying…',
    'error.gatewayRejected': 'The campus gateway is temporarily refusing the data channel; retries stopped. Wait a minute and connect again.',
    'error.reconnectFailed': 'Connection dropped and automatic reconnects failed; reconnect manually or check the logs',
    'error.connectFailed': 'Connection failed; retry or check the logs',
    'error.engineStuck': 'The engine could not be stopped; quit the app and try again',
    'error.tunnelRecovering': 'Campus tunnel unresponsive; recovering…',
    'error.pacWriteAfterSave': 'Settings saved, but writing the PAC file failed: {message}',
    'error.passwordStoreUnavailable': 'System secure storage is unavailable; the password was not saved',
    'error.connectTimeout': 'Timed out connecting to the campus network; retry or check the logs',
    'error.browserStart': 'Failed to start the campus browser: {message}',
    'error.pacWriteAtBoot': 'Could not write the PAC file: {message}',
    'error.startupTitle': 'HKUST(GZ) Connect failed to start',

    'engine.authFailed': 'Login failed: wrong account or password; automatic retries stopped',
    'engine.authUnsupported': 'Gateway authentication method is not supported (it may have moved to SSO/MFA)',
    'engine.portBusy': 'Port {port} is in use; choose another port in Control Tower',
    'engine.channelClosed': 'The campus gateway channel is temporarily closed; cleaning up the session and retrying…',

    'url.tooLong': 'The URL is too long',
    'url.invalid': 'Invalid URL format',
    'url.schemeUnsupported': 'The campus browser only supports HTTP and HTTPS URLs',

    'route.campus': 'Campus tunnel',
    'route.direct': 'Direct',
    'route.switchFailed': 'Failed to switch network route: {message}',

    'tab.new': 'New Tab',
    'browser.windowTitle': 'HKUST(GZ) Campus Browser',

    'cert.unknown': 'Unknown',
    'cert.site': 'Site: {origin}',
    'cert.chromiumError': 'Chromium error: {error}',
    'cert.subject': 'Subject: {subject}',
    'cert.issuer': 'Issuer: {issuer}',
    'cert.validity': 'Validity: {start} to {end}',
    'cert.fingerprint': 'Certificate SHA-256: {fingerprint}',
    'cert.scope': 'The fingerprint is saved only for this exact origin; other ports, subdomains, and sites with the same domain do not inherit this trust.',
    'cert.title': 'Confirm Website Certificate',
    'cert.message': 'Trust this certificate only for {origin}?',
    'cert.trust': 'Trust This Certificate',

    'common.cancel': 'Cancel',

    'download.interrupted': 'Download incomplete: {filename}',
    'download.noLocation': 'Could not choose a download location',

    'cred.saveTitle': 'Save Campus Site Password',
    'cred.saveMessage': 'Save this login for {host}?',
    'cred.saveDetail': 'The saved copy is encrypted and stored only on this computer; it is never uploaded to the maintainers or GitHub.',
    'cred.save': 'Save',
    'cred.later': 'Not Now',
    'cred.writeFailed': 'The site password could not be written to local secure storage',
    'cred.httpsOnly': 'Site passwords only work on HTTPS pages',
    'cred.title': 'Site Password',
    'cred.noneMessage': 'No password saved for {host}',
    'cred.noneDetail': 'After you submit a login form, the campus browser will offer to save it on this computer.',
    'cred.ok': 'OK',
    'cred.hasMessage': 'A login is saved for {host}',
    'cred.hasDetail': 'You can fill it into the current login page, or delete the credential stored on this computer.',
    'cred.fill': 'Fill Login Page',
    'cred.delete': 'Delete Saved',
    'cred.readFailed': 'The site password could not be read from local secure storage',

    'errorPage.title': 'Campus Site Unavailable',
    'errorPage.heading': 'This campus site can’t be opened right now',
    'errorPage.body': 'Make sure HKUST(GZ) Connect still shows “Connected”, or check the URL and use reload above.',
    'errorPage.unknownUrl': 'Unknown URL',
    'errorPage.networkFailed': 'Network request failed',
  },
};

// 'zh-Hans-CN' → 'zh', everything else explicit → 'en', absent/blank → 'zh'
// (Chinese stays the fallback so locale-less dev/test runs keep working).
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

// A saved 'zh'/'en' choice wins over the OS locale; 'auto' (or anything
// unexpected) defers to resolveLocale, which itself falls back to Chinese.
function effectiveLocale(language, systemLocale) {
  return language === 'zh' || language === 'en'
    ? language
    : resolveLocale(systemLocale);
}

module.exports = { createT, dictionaries, effectiveLocale, resolveLocale };
