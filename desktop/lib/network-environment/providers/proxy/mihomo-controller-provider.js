'use strict';

const path = require('node:path');

const LOOPBACKS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const MODES = new Set(['direct', 'rule', 'global', 'script']);

function unixProcessTable(output) {
  return String(output || '').split(/\r?\n/u).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/u);
    return match ? { pid: Number(match[1]), executable: match[2], args: match[3] } : null;
  }).filter(Boolean);
}

function windowsProcessTable(output) {
  try {
    const parsed = JSON.parse(String(output || ''));
    return (Array.isArray(parsed) ? parsed : parsed ? [parsed] : []).map((item) => ({
      pid: Number(item.ProcessId) || 0,
      executable: typeof item.Name === 'string' ? item.Name : '',
      args: typeof item.CommandLine === 'string' ? item.CommandLine : '',
    })).filter(({ executable, args }) => executable || args);
  } catch { return []; }
}

function flagValue(args, names) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
  return String(args || '').match(new RegExp(`(?:^|\\s)(?:${escaped})(?:=|\\s+)("[^"]+"|'[^']+'|\\S+)`, 'u'))?.[1]
    ?.replace(/^(?:"|')|(?:"|')$/gu, '') || '';
}

async function controllerRequest(process, run, platform) {
  const socket = flagValue(process.args, ['-ext-ctl-unix', '--external-controller-unix']);
  const controller = flagValue(process.args, ['-ext-ctl', '--external-controller']);
  const curlCommands = platform === 'win32' ? ['curl.exe'] : ['/usr/bin/curl', '/usr/local/bin/curl', 'curl'];
  const requests = [];
  if (platform !== 'win32' && socket && path.isAbsolute(socket) && socket.length <= 512) {
    requests.push(['--silent', '--max-time', '1', '--unix-socket', socket, 'http://localhost/configs']);
  }
  if (controller) {
    const normalized = controller.includes('://') ? controller : `http://${controller}`;
    try {
      const url = new URL(normalized);
      if (LOOPBACKS.has(url.hostname) && Number(url.port) > 0) {
        requests.push(['--silent', '--max-time', '1', `${url.origin}/configs`]);
      }
    } catch {}
  }
  for (const args of requests) {
    for (const command of curlCommands) {
      const raw = await run(command, args, { timeout: 1500 });
      if (raw) return raw;
    }
  }
  return '';
}

async function mihomoOwner({ processes = [], endpoint, run, platform = process.platform }) {
  if (!endpoint || !LOOPBACKS.has(endpoint.host)) return null;
  const matching = processes.filter((item) => /mihomo|clash/iu.test(`${item.executable} ${item.args}`));
  const candidates = [...matching].sort((left, right) => (
    Number(/(?:ext-ctl|external-controller)/u.test(right.args)) -
    Number(/(?:ext-ctl|external-controller)/u.test(left.args)) ||
    Number(/mihomo/iu.test(right.args)) - Number(/mihomo/iu.test(left.args))
  ));
  const candidate = candidates[0];
  if (!candidate) return null;
  const observed = { provider: 'mihomo', name: /mihomo/iu.test(candidate.args)
    ? 'Mihomo / Clash' : path.basename(candidate.executable) || 'Clash',
    mode: 'unknown', tunEnabled: null, confidence: 'observed' };
  for (const process of candidates) {
    try {
      const config = JSON.parse(await controllerRequest(process, run, platform));
      const ports = ['mixed-port', 'port', 'socks-port'].map((key) => Number(config[key]))
        .filter((port) => Number.isInteger(port) && port > 0);
      if (!ports.includes(endpoint.port)) continue;
      return { ...observed, mode: MODES.has(config.mode) ? config.mode : 'unknown',
        tunEnabled: typeof config.tun?.enable === 'boolean' ? config.tun.enable : null,
        confidence: 'confirmed' };
    } catch {}
  }
  return observed;
}

module.exports = { controllerRequest, flagValue, mihomoOwner, unixProcessTable, windowsProcessTable };
