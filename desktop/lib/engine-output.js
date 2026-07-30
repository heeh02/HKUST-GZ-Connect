'use strict';

function classifyEngineOutput(text, socksPort) {
  if (/gateway authentication failed|login failed|invalid username/i.test(text)) {
    return '登录失败：账号或密码错误，已停止自动重试';
  }
  if (/not implemented auth|authentication method is unsupported/i.test(text)) {
    return '网关鉴权方式不受支持（可能已改为 SSO/MFA）';
  }
  if (/cannot bind the SOCKS5 listener|address already in use|bind:/i.test(text)) {
    return `端口 ${socksPort} 被占用，请在控制塔更换端口`;
  }
  if (/modern address reply (?:has an unexpected status|rejected the request)/i.test(text)) {
    return '网关暂未分配校园网地址，正在清理会话并自动重试…';
  }
  if (/modern (?:address|send|receive) (?:TLS|request|reply):/i.test(text)) {
    return '校园网关通道暂时关闭，正在清理会话并自动重试…';
  }
  return null;
}

function engineFailureKind(text) {
  if (
    /gateway authentication failed|login failed|invalid username|not implemented auth|authentication method is unsupported/i
      .test(text)
  ) {
    return 'terminal';
  }
  if (/modern address reply (?:has an unexpected status|rejected the request)/i.test(text)) {
    return 'gateway-transient';
  }
  if (/modern (?:address|send|receive) (?:TLS|request|reply):/i.test(text)) {
    return 'gateway-transient';
  }
  return 'unknown';
}

module.exports = { classifyEngineOutput, engineFailureKind };
