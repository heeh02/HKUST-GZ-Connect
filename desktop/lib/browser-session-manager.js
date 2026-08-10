'use strict';

const {
  CAMPUS_PARTITION,
  ROUTE_CAMPUS,
  ROUTE_DIRECT,
} = require('./campus-route');
const { buildDomainRoutePac, resolveDomainRouteForUrl } = require('./domain-route-policy');
const { isUnsafeBrowserTargetUrl } = require('./host-safety');
const { normalizeRuleHost } = require('./routing-rule-store');

const requestBoundaryGates = new WeakMap();
const CAMPUS_REQUEST_FILTER = Object.freeze({
  // Deliberately omit `types`: the boundary applies to main frames and every
  // subresource type, including fetch/XHR, WebSocket upgrades, media, and CSP.
  urls: Object.freeze(['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']),
});
const FAIL_CLOSED_PROXY = 'PROXY 0.0.0.0:0';
const FAIL_CLOSED_PAC = `'use strict';\nfunction FindProxyForURL() { return "${FAIL_CLOSED_PROXY}"; }\n`;

function normalizeProxyPort(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1025 || value > 65535) {
    throw new Error('本地代理端口无效');
  }
  return value;
}

function campusProxyConfig(port) {
  const value = normalizeProxyPort(port);
  return {
    mode: 'fixed_servers',
    proxyRules: `socks5://127.0.0.1:${value}`,
    proxyBypassRules: '<-loopback>',
  };
}

function pacDataUrl(source) {
  return `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(source).toString('base64')}`;
}

function failClosedProxyConfig() {
  return {
    mode: 'pac_script',
    pacScript: pacDataUrl(FAIL_CLOSED_PAC),
    proxyBypassRules: '<-loopback>',
  };
}

function createMemoryRoutingPolicy() {
  let userRules = [];
  return {
    list: () => userRules.map((rule) => ({ ...rule })),
    resolve: (url, inheritedRoute = null) => resolveDomainRouteForUrl(url, {
      userRules,
      inheritedRoute,
    }),
    upsert(payload) {
      const host = normalizeRuleHost(payload?.host);
      const includeSubdomains = payload?.includeSubdomains === true;
      const route = payload?.route;
      if (![ROUTE_CAMPUS, ROUTE_DIRECT].includes(route)) throw new Error('浏览器网络路径无效');
      const rule = { host, includeSubdomains, route, updatedAt: Date.now() };
      userRules = [rule, ...userRules.filter((candidate) => !(
        candidate.host === host && candidate.includeSubdomains === includeSubdomains
      ))];
      return { rule, rules: userRules.map((candidate) => ({ ...candidate })) };
    },
    proxyConfig(port) {
      return {
        mode: 'pac_script',
        pacScript: pacDataUrl(buildDomainRoutePac({ userRules }, port)),
        proxyBypassRules: '<-loopback>',
      };
    },
  };
}

// A campus web page is untrusted content. Nothing it renders needs the camera,
// microphone, location, notifications, or a USB/serial device, so every request
// is refused without prompting the user.
function applyCampusSessionPolicy(campusSession) {
  if (!campusSession || typeof campusSession !== 'object') {
    throw new Error('校园浏览器 Session 无效');
  }
  if (typeof campusSession.setPermissionRequestHandler === 'function') {
    campusSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  }
  if (typeof campusSession.setPermissionCheckHandler === 'function') {
    campusSession.setPermissionCheckHandler(() => false);
  }
  if (typeof campusSession.setDevicePermissionHandler === 'function') {
    campusSession.setDevicePermissionHandler(() => false);
  }
  applyCampusRequestBoundary(campusSession);
  return campusSession;
}

function applyCampusRequestBoundary(campusSession) {
  if (!campusSession || typeof campusSession !== 'object' ||
      typeof campusSession.webRequest?.onBeforeRequest !== 'function' ||
      requestBoundaryGates.has(campusSession)) {
    return campusSession;
  }
  const gate = { blocked: false };
  campusSession.webRequest.onBeforeRequest(CAMPUS_REQUEST_FILTER, (details, callback) => {
    callback({ cancel: gate.blocked || isUnsafeBrowserTargetUrl(details?.url) });
  });
  requestBoundaryGates.set(campusSession, gate);
  return campusSession;
}

function setCampusRequestBlocked(campusSession, blocked) {
  const gate = requestBoundaryGates.get(campusSession);
  if (!gate) return false;
  gate.blocked = blocked === true;
  return true;
}

function campusRequestsBlocked(campusSession) {
  return requestBoundaryGates.get(campusSession)?.blocked === true;
}

function validatePacProxyConfig(config) {
  if (!config || config.mode !== 'pac_script' || typeof config.pacScript !== 'string' ||
      !config.pacScript || config.proxyBypassRules !== '<-loopback>') {
    throw new Error('校园浏览器 PAC 配置无效');
  }
  return config;
}

class BrowserSessionManager {
  constructor({
    session,
    routingPolicy,
    partition = CAMPUS_PARTITION,
    onSessionReady,
  } = {}) {
    this.electronSession = session;
    this.routingPolicy = routingPolicy;
    this.partition = partition;
    this.onSessionReady = typeof onSessionReady === 'function' ? onSessionReady : null;
    this.configuredPort = null;
    this.sessionKey = '';
    this.campusSession = null;
    this.sessions = new Map();
    this.suspended = false;
    this.intentEpoch = 0;
    this.operationChain = Promise.resolve();
  }

  serialize(operation) {
    const next = this.operationChain.then(operation, operation);
    this.operationChain = next.catch(() => {});
    return next;
  }

  async policyProxyConfig(port) {
    if (!this.routingPolicy || typeof this.routingPolicy.proxyConfig !== 'function') {
      throw new Error('校园浏览器路由策略无效');
    }
    return validatePacProxyConfig(await this.routingPolicy.proxyConfig(normalizeProxyPort(port)));
  }

  sessionForRoute(route = ROUTE_CAMPUS) {
    if (![ROUTE_CAMPUS, ROUTE_DIRECT].includes(route)) return null;
    return this.sessions.get(route) || this.campusSession || null;
  }

  isCurrentIntent(epoch) {
    return epoch === this.intentEpoch;
  }

  get requestsBlocked() {
    return !this.campusSession || campusRequestsBlocked(this.campusSession);
  }

  async applyFailClosed(browserSession, epoch) {
    if (!browserSession || !this.isCurrentIntent(epoch)) return null;
    setCampusRequestBlocked(browserSession, true);
    const proxyConfig = failClosedProxyConfig();
    if (typeof browserSession.setProxy !== 'function') {
      throw new Error('校园浏览器 Session 无法进入安全暂停状态');
    }
    if (typeof browserSession.forceReloadProxyConfig !== 'function' ||
        typeof browserSession.closeAllConnections !== 'function') {
      throw new Error('校园浏览器 Session 缺少安全切换能力');
    }
    await browserSession.setProxy(proxyConfig);
    if (!this.isCurrentIntent(epoch)) return null;
    await browserSession.forceReloadProxyConfig();
    if (!this.isCurrentIntent(epoch)) return null;
    await browserSession.closeAllConnections();
    if (!this.isCurrentIntent(epoch)) return null;
    this.sessionKey = JSON.stringify(proxyConfig);
    return browserSession;
  }

  async configureNow(port, { force = false, epoch } = {}) {
    const value = normalizeProxyPort(port);
    if (!this.electronSession || typeof this.electronSession.fromPartition !== 'function') {
      throw new Error('校园浏览器 Session 不可用');
    }

    let browserSession = this.campusSession;
    if (!browserSession) {
      browserSession = applyCampusSessionPolicy(
        this.electronSession.fromPartition(this.partition),
      );
      this.onSessionReady?.(browserSession);
    }

    // The in-process request gate is authoritative. Keep it closed for the
    // whole activation and open it only after every async step confirms that
    // no newer suspend/activation intent superseded this one.
    setCampusRequestBlocked(browserSession, true);
    const proxyConfig = await this.policyProxyConfig(value);
    if (!this.isCurrentIntent(epoch)) return null;
    const key = JSON.stringify(proxyConfig);
    if (force || this.sessionKey !== key) {
      if (typeof browserSession.setProxy !== 'function') {
        throw new Error('校园浏览器 Session 无法配置代理');
      }
      if (typeof browserSession.forceReloadProxyConfig !== 'function' ||
          typeof browserSession.closeAllConnections !== 'function') {
        throw new Error('校园浏览器 Session 缺少安全切换能力');
      }
      await browserSession.setProxy(proxyConfig);
      if (!this.isCurrentIntent(epoch)) return null;
      await browserSession.forceReloadProxyConfig();
      if (!this.isCurrentIntent(epoch)) return null;
      await browserSession.closeAllConnections();
      if (!this.isCurrentIntent(epoch)) return null;
      this.sessionKey = key;
    }

    if (!this.isCurrentIntent(epoch)) return null;

    // Chromium chooses DIRECT or the loopback proxy through PAC while cookies,
    // storage, SSO POST state, and certificate decisions stay in one Session.
    this.sessions.set(ROUTE_CAMPUS, browserSession);
    this.sessions.set(ROUTE_DIRECT, browserSession);
    this.configuredPort = value;
    this.campusSession = browserSession;
    this.suspended = false;
    setCampusRequestBlocked(browserSession, false);
    return browserSession;
  }

  configure(port, options = {}) {
    const value = normalizeProxyPort(port);
    const epoch = ++this.intentEpoch;
    if (this.campusSession) setCampusRequestBlocked(this.campusSession, true);
    return this.serialize(async () => {
      if (!this.isCurrentIntent(epoch)) return null;
      try {
        return await this.configureNow(value, { ...options, epoch });
      } catch (error) {
        if (this.isCurrentIntent(epoch)) {
          this.suspended = true;
          if (this.campusSession) setCampusRequestBlocked(this.campusSession, true);
          try { await this.applyFailClosed(this.campusSession, epoch); } catch {}
        }
        throw error;
      }
    });
  }

  // Mark the manager suspended synchronously so a configure already queued by
  // another UI action can never restore a live proxy after shutdown begins.
  // The serialized PAC update is the actual hand-off barrier: callers await it
  // before allowing the engine to release its loopback listener.
  suspend() {
    const epoch = ++this.intentEpoch;
    this.suspended = true;
    if (this.campusSession) setCampusRequestBlocked(this.campusSession, true);
    return this.serialize(async () => {
      if (!this.isCurrentIntent(epoch)) return null;
      const browserSession = this.campusSession;
      if (!browserSession) {
        this.sessionKey = '';
        return null;
      }
      return this.applyFailClosed(browserSession, epoch);
    });
  }

  resume(port = this.configuredPort) {
    return this.configure(port, { force: true });
  }
}

module.exports = {
  BrowserSessionManager,
  CAMPUS_REQUEST_FILTER,
  FAIL_CLOSED_PAC,
  FAIL_CLOSED_PROXY,
  applyCampusRequestBoundary,
  applyCampusSessionPolicy,
  campusRequestsBlocked,
  campusProxyConfig,
  createMemoryRoutingPolicy,
  failClosedProxyConfig,
  normalizeProxyPort,
  pacDataUrl,
  setCampusRequestBlocked,
  validatePacProxyConfig,
};
