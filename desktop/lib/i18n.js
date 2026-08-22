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
    'error.invalidStoredCredentials': '本机保存的账号或密码格式无效，请重新登录',
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
    'error.connectionSuspended': '电脑已进入睡眠，校园连接已安全暂停；唤醒后将按设置恢复',
    'error.networkUnavailable': '当前网络不可用，校园连接已安全暂停；网络恢复后将按设置重连',
    'error.proxyCredentialUnavailable': '无法安全读取或保存本地代理凭据；为避免外部工具配置失效，现有凭据不会自动更换，请检查本机安全存储后重试',
    'error.pacWriteAfterSave': '设置已保存，但 PAC 文件写入失败：{message}',
    'error.browserRoutingAfterSave': '设置已保存，但校园浏览器网络规则刷新失败：{message}',
    'error.passwordStoreUnavailable': '系统安全存储不可用，密码未保存',
    'error.settingsSaveFailed': '设置写入失败，账号和密码均未更改，请重试',
    'error.settingsReadFailed': '设置文件暂时无法读取；为避免使用不一致配置，本次操作已停止，请检查文件占用或磁盘状态后重试',
    'error.settingsSaveFailedPasswordCleared': '设置写入失败；为避免账号与密码不匹配，本地密码已清除，请重新输入',
    'error.credentialPolicyCombined': '账号密码与网络路径设置不能在同一次保存中提交，请分别保存后重试',
    'error.usernameNeedsPassword': '更换账号时必须同时输入对应密码，原账号与密码未更改',
    'error.credentialRecoveryBlocked': '上次账号密码保存未完成，安全恢复暂时受阻；已禁止连接，请退出占用文件的程序或重启后重试',
    'error.credentialRecoveryRecovered': '检测到上次账号密码保存被中断，已恢复为中断前匹配的账号和密码',
    'error.credentialRecoveryCleared': '检测到无法验证的账号密码保存记录，本机密码已安全清除，请重新输入',
    'error.logoutFailed': '退出登录未能安全完成，原账号和密码已保留，请重试',
    'error.logoutFailedPasswordCleared': '退出登录未能完整保存账号设置；本机密码已清除，账号设置可能未完成，请重新登录',
    'error.connectTimeout': '连接校园网络超时，请重试或查看日志',
    'error.browserStart': '校园浏览器启动失败：{message}',
    'error.pacWriteAtBoot': '无法写入 PAC 文件：{message}',
    'error.settingsRestored': '检测到设置文件损坏，已从本机备份恢复；请检查端口和偏好设置',
    'error.settingsDefaults': '设置文件损坏且备份不可用，已恢复安全默认值；请重新检查端口和偏好设置',
    'error.startupTitle': 'HKUST(GZ) Connect 启动失败',

    'engine.authFailed': '登录失败：账号或密码错误，已停止自动重试',
    'engine.authRejected': '登录未通过：账号或密码未被网关接受，已停止自动重试',
    'engine.authIndeterminate': '登录结果无法确认，已安全停止自动重试；请稍后手动重试',
    'engine.authProtocolInvalid': '校园网关的认证响应与当前版本不兼容，已安全停止',
    'engine.authCleanupUnconfirmed': '远端会话清理未能确认，请稍后再手动连接',
    'engine.authExpired': '登录验证已过期，请重新连接',
    'engine.authLimitExceeded': '登录验证操作已达到本机安全上限，请重新连接',
    'engine.authUnsupported': '网关鉴权方式不受支持（可能已改为 SSO/MFA）',
    'engine.portBusy': '端口 {port} 被占用，请在控制塔更换端口',
    'engine.channelClosed': '校园网关通道暂时关闭，正在清理会话并自动重试…',
    'engine.configurationInvalid': '引擎配置无效，请恢复默认设置或重新安装当前版本',
    'engine.eventOutputFailed': '引擎状态通道异常，已安全停止；请重试或查看日志',

    'url.tooLong': '网址过长',
    'url.invalid': '网址格式不正确',
    'url.schemeUnsupported': '校园浏览器只支持 HTTP 和 HTTPS 网址',

    'route.campus': '校园隧道',
    'route.direct': '直连',
    'route.switchFailed': '切换网络路径失败：{message}',

    'tab.new': '新标签页',
    'tab.limit': '最多同时打开 {count} 个标签页，请先关闭不再使用的页面',
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
    'errorPage.rendererCrash': '页面进程已停止（{reason}）。只有这个标签页受到影响，请点击上方的重新加载进行恢复。',
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
    'error.invalidStoredCredentials': 'The locally saved account or password has an invalid format; sign in again.',
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
    'error.connectionSuspended': 'The computer is asleep; the campus connection is safely paused and will recover according to your settings after wake',
    'error.networkUnavailable': 'The network is unavailable; the campus connection is safely paused and will reconnect according to your settings when it returns',
    'error.proxyCredentialUnavailable': 'Could not securely read or save the local proxy credential. It was not silently replaced, so existing external-tool configuration remains protected; check system secure storage and retry.',
    'error.pacWriteAfterSave': 'Settings saved, but writing the PAC file failed: {message}',
    'error.browserRoutingAfterSave': 'Settings saved, but refreshing campus-browser routing failed: {message}',
    'error.passwordStoreUnavailable': 'System secure storage is unavailable; the password was not saved',
    'error.settingsSaveFailed': 'Could not write settings; the account and password were left unchanged. Try again.',
    'error.settingsReadFailed': 'Settings are temporarily unreadable. This operation was stopped to avoid inconsistent configuration; check file access or disk health and retry.',
    'error.settingsSaveFailedPasswordCleared': 'Could not write settings; the local password was cleared to avoid an account/password mismatch. Enter it again.',
    'error.credentialPolicyCombined': 'Credentials and network-routing settings cannot be committed together. Save them separately and retry.',
    'error.usernameNeedsPassword': 'Changing the account also requires its matching password. The previous account and password were left unchanged.',
    'error.credentialRecoveryBlocked': 'A previous credential save was interrupted and safe recovery is temporarily blocked. Connections are disabled; close any program using the files or restart and retry.',
    'error.credentialRecoveryRecovered': 'An interrupted credential save was detected. The matching account and password from before that save were restored.',
    'error.credentialRecoveryCleared': 'An unverifiable credential-save record was detected. The local password was safely cleared; enter it again.',
    'error.logoutFailed': 'Sign-out could not be completed safely. The previous account and password were preserved; retry.',
    'error.logoutFailedPasswordCleared': 'Sign-out did not fully save the account setting. The local password was cleared, but the displayed account may not have been removed; sign in again.',
    'error.connectTimeout': 'Timed out connecting to the campus network; retry or check the logs',
    'error.browserStart': 'Failed to start the campus browser: {message}',
    'error.pacWriteAtBoot': 'Could not write the PAC file: {message}',
    'error.settingsRestored': 'The settings file was damaged and restored from a local backup; review the port and preferences',
    'error.settingsDefaults': 'The settings file and backup were unusable; safe defaults were restored. Review the port and preferences',
    'error.startupTitle': 'HKUST(GZ) Connect failed to start',

    'engine.authFailed': 'Login failed: wrong account or password; automatic retries stopped',
    'engine.authRejected': 'Login was rejected: the gateway did not accept the account or password; automatic retries stopped',
    'engine.authIndeterminate': 'The login result could not be confirmed. Automatic retries stopped safely; retry manually later.',
    'engine.authProtocolInvalid': 'The gateway authentication response is incompatible with this version and was stopped safely',
    'engine.authCleanupUnconfirmed': 'Remote session cleanup could not be confirmed; wait before connecting manually again',
    'engine.authExpired': 'Login verification expired; reconnect to start again',
    'engine.authLimitExceeded': 'Login verification reached this client’s safety limit; reconnect to start again',
    'engine.authUnsupported': 'Gateway authentication method is not supported (it may have moved to SSO/MFA)',
    'engine.portBusy': 'Port {port} is in use; choose another port in Control Tower',
    'engine.channelClosed': 'The campus gateway channel is temporarily closed; cleaning up the session and retrying…',
    'engine.configurationInvalid': 'The engine configuration is invalid; restore defaults or reinstall this version',
    'engine.eventOutputFailed': 'The engine status channel failed and stopped safely; retry or check the logs',

    'url.tooLong': 'The URL is too long',
    'url.invalid': 'Invalid URL format',
    'url.schemeUnsupported': 'The campus browser only supports HTTP and HTTPS URLs',

    'route.campus': 'Campus tunnel',
    'route.direct': 'Direct',
    'route.switchFailed': 'Failed to switch network route: {message}',

    'tab.new': 'New Tab',
    'tab.limit': 'Up to {count} tabs can be open; close a tab you no longer need',
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
    'errorPage.rendererCrash': 'The page process stopped ({reason}). Only this tab was affected; use reload above to recover it.',
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
