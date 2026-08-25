'use strict';

const { execFile } = require('node:child_process');

const MAX_TRACKED_PROCESS_NAMES = 256;
const MAX_COMMAND_OUTPUT_BYTES = 512 * 1024;

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(command, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    }, (_error, stdout) => resolve(String(stdout || '')));
  });
}

function normalizePorts(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map(Number)
    .filter((port) => Number.isInteger(port) && port >= 1025 && port <= 65535))];
}

function friendlyProcessName(value) {
  const name = String(value || '').trim();
  if (/hkustgzconnect/i.test(name)) return 'HKUST(GZ) Connect';
  if (/Chrome|chrome/.test(name)) return 'Google Chrome';
  if (/Code Helper|Visual Studio Code/i.test(name)) return 'VS Code';
  if (/Microsoft Edge|msedge/i.test(name)) return 'Microsoft Edge';
  if (/Lark|Feishu|飞书/i.test(name)) return 'Lark/飞书';
  if (/firefox/i.test(name)) return 'Firefox';
  if (name === 'ssh' || name === 'sshd') return 'SSH';
  return name;
}

function parseWindowsConnections(output, excludedPids = new Set()) {
  let values = [];
  try {
    const parsed = JSON.parse(output);
    values = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return { connCount: 0, apps: [] };
  }
  const apps = values
    .filter((value) => value && !excludedPids.has(Number(value.Pid)))
    .map((value) => ({
      pid: Number(value.Pid),
      name: friendlyProcessName(value.Name || String(value.Pid)),
      count: Math.max(0, Number(value.Count) || 0),
    }))
    .filter((value) => Number.isInteger(value.pid) && value.pid > 0 && value.count > 0)
    .sort((left, right) => right.count - left.count);
  return { connCount: apps.reduce((sum, app) => sum + app.count, 0), apps };
}

function parseLsofConnections(output, ports, excludedPids = new Set()) {
  const allowedPorts = new Set(ports);
  const commands = new Map();
  const perPid = new Map();
  const seenConnections = new Set();
  let pid = null;
  for (const line of String(output || '').split('\n')) {
    const kind = line[0];
    const value = line.slice(1);
    if (kind === 'p') pid = Number(value);
    else if (kind === 'c' && Number.isInteger(pid)) commands.set(pid, value);
    else if (kind === 'n' && Number.isInteger(pid) && !excludedPids.has(pid)) {
      const match = value.match(/->(?:127\.0\.0\.1|\[::1\]):(\d+)$/u);
      if (!match || !allowedPorts.has(Number(match[1]))) continue;
      const key = `${pid}\u0000${value}`;
      if (seenConnections.has(key)) continue;
      seenConnections.add(key);
      perPid.set(pid, (perPid.get(pid) || 0) + 1);
    }
  }
  return { commands, perPid, connCount: seenConnections.size };
}

class AppConnectionEnumerator {
  constructor({
    platform = process.platform,
    run = runCommand,
  } = {}) {
    this.platform = platform;
    this.run = run;
    this.processNames = new Map();
  }

  async resolveProcessName(pid, fallback) {
    if (this.processNames.has(pid)) return this.processNames.get(pid);
    const output = await this.run('ps', ['-p', String(pid), '-o', 'comm='], 800);
    const full = output.trim();
    const name = full ? full.split('/').pop() : fallback;
    if (this.processNames.size >= MAX_TRACKED_PROCESS_NAMES) this.processNames.clear();
    this.processNames.set(pid, name);
    return name;
  }

  async list({ ports, enginePid = -1, appPid = process.pid } = {}) {
    const normalizedPorts = normalizePorts(ports);
    if (!normalizedPorts.length) return { connCount: 0, apps: [] };
    const excluded = new Set([Number(enginePid), Number(appPid)].filter(Number.isInteger));
    try {
      if (this.platform === 'win32') {
        const filter = normalizedPorts.map((port) => `$_.RemotePort -eq ${port}`).join(' -or ');
        const script = [
          '$r=Get-NetTCPConnection -State Established -RemoteAddress 127.0.0.1 -EA SilentlyContinue',
          `|?{${filter}}`,
          '|Group-Object OwningProcess',
          '|%{$p=Get-Process -Id $_.Name -EA SilentlyContinue;',
          '[pscustomobject]@{Pid=[int]$_.Name;Name=$p.ProcessName;Count=$_.Count}};',
          '$r|ConvertTo-Json -Compress',
        ].join('');
        return parseWindowsConnections(
          await this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 4000),
          excluded,
        );
      }

      // Give lsof the exact SOCKS listener port. The old broad
      // `-iTCP@127.0.0.1` query enumerated every loopback connection on the
      // computer before filtering in JavaScript.
      const selectors = normalizedPorts.map((port) => `-iTCP@127.0.0.1:${port}`);
      const output = await this.run(
        'lsof',
        ['-nP', ...selectors, '-sTCP:ESTABLISHED', '-F', 'pcn'],
        1500,
      );
      const parsed = parseLsofConnections(output, normalizedPorts, excluded);
      const apps = [];
      for (const [pid, count] of parsed.perPid) {
        const fallback = parsed.commands.get(pid) || String(pid);
        const name = await this.resolveProcessName(pid, fallback);
        apps.push({ pid, name: friendlyProcessName(name), count });
      }
      apps.sort((left, right) => right.count - left.count);
      return { connCount: parsed.connCount, apps };
    } catch {
      return { connCount: 0, apps: [] };
    }
  }
}

module.exports = {
  AppConnectionEnumerator,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_TRACKED_PROCESS_NAMES,
  friendlyProcessName,
  normalizePorts,
  parseLsofConnections,
  parseWindowsConnections,
  runCommand,
};
