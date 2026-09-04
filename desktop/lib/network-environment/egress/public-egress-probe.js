'use strict';

const https = require('node:https');
const net = require('node:net');

const ENDPOINT = Object.freeze({
  hostname: 'api64.ipify.org',
  path: '/?format=json',
  provider: 'ipify',
});
const RESPONSE_LIMIT = 1024;
const DEFAULT_TIMEOUT_MS = 2800;
const DEFAULT_CONCURRENCY = 4;

function probeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizedIp(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  const family = net.isIP(input);
  if (!family) return '';
  if (family === 4) return input;
  try {
    return net.SocketAddress.parse(`[${input}]:443`)?.address?.toLowerCase() || '';
  } catch { return ''; }
}

function isPublicAddress(value) {
  const ip = normalizedIp(value);
  const family = net.isIP(ip);
  if (family === 4) {
    const octets = ip.split('.').map(Number);
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0 && (c === 0 || c === 2)) ||
        (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113)) return false;
    return true;
  }
  if (family === 6) {
    return ip !== '::' && ip !== '::1' && !ip.startsWith('::ffff:') &&
      !ip.startsWith('fc') && !ip.startsWith('fd') &&
      !/^fe[89ab]/u.test(ip) && !ip.startsWith('ff') &&
      !ip.startsWith('2001:db8:');
  }
  return false;
}

function parseObservedPublicIp(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > RESPONSE_LIMIT) return '';
  let candidate = '';
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        Object.keys(parsed).length === 1 && typeof parsed.ip === 'string') candidate = parsed.ip;
  } catch { candidate = value; }
  const ip = normalizedIp(candidate);
  return isPublicAddress(ip) ? ip : '';
}

function createHttpsRequester({
  httpsModule = https,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  endpoint = ENDPOINT,
} = {}) {
  const agent = new httpsModule.Agent({
    keepAlive: false,
    maxSockets: DEFAULT_CONCURRENCY,
    maxTotalSockets: DEFAULT_CONCURRENCY,
    proxyEnv: {},
  });
  const requester = ({ sourceAddress, family, signal }) => new Promise((resolve, reject) => {
    let settled = false;
    let bound = false;
    let deadline = null;
    const finish = (error, value = null) => {
      if (settled) return;
      settled = true;
      if (deadline !== null) clearTimeout(deadline);
      signal?.removeEventListener?.('abort', abortRequest);
      if (error) reject(error); else resolve(value);
    };
    const abortRequest = () => request.destroy(probeError('PUBLIC_EGRESS_CANCELLED'));
    const request = httpsModule.request({
      protocol: 'https:',
      hostname: endpoint.hostname,
      port: 443,
      path: endpoint.path,
      method: 'GET',
      family,
      localAddress: sourceAddress,
      agent,
      headers: Object.freeze({
        Accept: 'application/json',
        'Cache-Control': 'no-store',
      }),
    }, (response) => {
      if (response.statusCode !== 200) {
        finish(probeError('PUBLIC_EGRESS_HTTP_STATUS'));
        response.destroy();
        return;
      }
      let body = '';
      let bytes = 0;
      response.setEncoding('utf8');
      response.on('aborted', () => finish(probeError('PUBLIC_EGRESS_UNAVAILABLE')));
      response.on('error', () => finish(probeError('PUBLIC_EGRESS_UNAVAILABLE')));
      response.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > RESPONSE_LIMIT) {
          request.destroy(probeError('PUBLIC_EGRESS_RESPONSE_TOO_LARGE'));
          return;
        }
        body += chunk;
      });
      response.on('end', () => {
        if (!bound) return finish(probeError('PUBLIC_EGRESS_SOURCE_NOT_BOUND'));
        const address = parseObservedPublicIp(body);
        if (!address) return finish(probeError('PUBLIC_EGRESS_INVALID_RESPONSE'));
        return finish(null, Object.freeze({
          address,
          family: net.isIP(address),
          binding: 'source-address',
          provider: endpoint.provider,
        }));
      });
    });
    request.once('socket', (socket) => {
      socket.once('connect', () => {
        bound = normalizedIp(socket.localAddress) === normalizedIp(sourceAddress);
      });
    });
    deadline = setTimeout(() => request.destroy(probeError('PUBLIC_EGRESS_TIMEOUT')), timeoutMs);
    deadline.unref?.();
    request.on('error', (error) => {
      finish(error?.code && String(error.code).startsWith('PUBLIC_EGRESS_')
        ? error : probeError('PUBLIC_EGRESS_UNAVAILABLE'));
    });
    if (signal?.aborted) abortRequest();
    else signal?.addEventListener?.('abort', abortRequest, { once: true });
    request.end();
  });
  requester.dispose = () => agent.destroy();
  return requester;
}

class PublicEgressProbe {
  constructor({ requestIp = createHttpsRequester(), concurrency = DEFAULT_CONCURRENCY,
    jobTimeoutMs = 5_000 } = {}) {
    if (typeof requestIp !== 'function' || !Number.isInteger(concurrency) ||
        concurrency < 1 || concurrency > 8 || !Number.isFinite(jobTimeoutMs) ||
        jobTimeoutMs < DEFAULT_TIMEOUT_MS || jobTimeoutMs > 15_000) {
      throw new TypeError('public egress probe dependencies are invalid');
    }
    this.requestIp = requestIp;
    this.concurrency = concurrency;
    this.jobTimeoutMs = jobTimeoutMs;
    this.active = 0;
    this.queue = [];
    this.activeTasks = new Set();
    this.disposed = false;
  }

  probe({ sourceAddress, family = net.isIP(sourceAddress) } = {}) {
    const address = normalizedIp(sourceAddress);
    if (this.disposed) return Promise.reject(probeError('PUBLIC_EGRESS_CANCELLED'));
    if (!address || family !== net.isIP(address) || ![4, 6].includes(family)) {
      return Promise.reject(probeError('PUBLIC_EGRESS_SOURCE_INVALID'));
    }
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const task = { request: { sourceAddress: address, family, signal: controller.signal },
        controller, resolve, reject, settled: false, timer: null };
      task.timer = setTimeout(() => {
        controller.abort();
        this.#settle(task, probeError('PUBLIC_EGRESS_TIMEOUT'));
      }, this.jobTimeoutMs);
      task.timer.unref?.();
      this.queue.push(task);
      this.#pump();
    });
  }

  cancel() {
    const error = probeError('PUBLIC_EGRESS_CANCELLED');
    for (const task of [...this.queue, ...this.activeTasks]) {
      task.controller.abort();
      this.#settle(task, error);
    }
    this.queue = [];
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.requestIp.dispose?.();
  }

  #settle(task, error = null, value = null) {
    if (task.settled) return;
    task.settled = true;
    clearTimeout(task.timer);
    if (error) task.reject(error); else task.resolve(value);
  }

  #pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift();
      if (task.settled) continue;
      this.active += 1;
      this.activeTasks.add(task);
      Promise.resolve().then(() => task.settled || task.controller.signal.aborted
        ? undefined : this.requestIp(task.request))
        .then((value) => this.#settle(task, null, value), (error) => this.#settle(task, error))
        .finally(() => {
          this.activeTasks.delete(task);
          this.active -= 1;
          this.#pump();
        });
    }
  }
}

module.exports = {
  PublicEgressProbe,
  createHttpsPublicEgressRequester: createHttpsRequester,
  isPublicEgressAddress: isPublicAddress,
  normalizePublicEgressIp: normalizedIp,
  parseObservedPublicIp,
};
