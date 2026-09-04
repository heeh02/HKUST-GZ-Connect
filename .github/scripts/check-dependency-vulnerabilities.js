'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LOCK_PATH = path.resolve(__dirname, '..', '..', 'desktop', 'package-lock.json');
const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const MAX_AUDIT_OUTPUT = 8 * 1024 * 1024;

function packageNameFromLockPath(lockPath) {
  if (typeof lockPath !== 'string') return '';
  const match = lockPath.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/u);
  return match?.[1] || '';
}

function exactLockQueries(lock) {
  if (!lock || typeof lock !== 'object' || !Number.isSafeInteger(lock.lockfileVersion) ||
      lock.lockfileVersion < 2 || !lock.packages || typeof lock.packages !== 'object') {
    throw new TypeError('dependency audit requires a package-lock v2+ packages map');
  }
  const seen = new Set();
  const queries = [];
  for (const [lockPath, record] of Object.entries(lock.packages)) {
    const name = packageNameFromLockPath(lockPath);
    const version = typeof record?.version === 'string' ? record.version : '';
    if (!name || !version || record.link === true) continue;
    if (name.length > 214 || version.length > 128 || /[\u0000-\u001f\u007f]/u.test(`${name}${version}`)) {
      throw new TypeError('dependency audit encountered an invalid package identity');
    }
    const identity = `${name}\u0000${version}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    queries.push(Object.freeze({
      package: Object.freeze({ ecosystem: 'npm', name }),
      version,
    }));
  }
  if (!queries.length || queries.length > 2_000) {
    throw new TypeError('dependency audit package count is invalid');
  }
  return Object.freeze(queries.sort((left, right) =>
    left.package.name.localeCompare(right.package.name) || left.version.localeCompare(right.version)));
}

function npmAuditReport(stdout, status) {
  let value;
  try { value = JSON.parse(String(stdout || '')); }
  catch { return Object.freeze({ kind: 'unavailable', reason: 'no structured npm audit response' }); }
  const vulnerabilities = value?.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object') {
    return Object.freeze({ kind: 'unavailable', reason: 'npm advisory service returned no report' });
  }
  const counts = {};
  for (const level of ['info', 'low', 'moderate', 'high', 'critical', 'total']) {
    const count = vulnerabilities[level];
    if (!Number.isSafeInteger(count) || count < 0) {
      return Object.freeze({ kind: 'unavailable', reason: 'npm advisory report was malformed' });
    }
    counts[level] = count;
  }
  const passed = status === 0 && counts.high === 0 && counts.critical === 0;
  return Object.freeze({ kind: 'report', passed, counts: Object.freeze(counts) });
}

function runNpmAudit({ cwd, spawn = spawnSync, env = process.env } = {}) {
  const npmCli = env.npm_execpath;
  if (typeof npmCli !== 'string' || !path.isAbsolute(npmCli)) {
    return Object.freeze({ kind: 'unavailable', reason: 'npm CLI path is unavailable' });
  }
  const result = spawn(process.execPath, [
    npmCli, 'audit', '--audit-level=high', '--json', '--fetch-timeout=60000', '--fetch-retries=0',
  ], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 70_000,
    maxBuffer: MAX_AUDIT_OUTPUT,
    windowsHide: true,
  });
  if (result.error) {
    return Object.freeze({ kind: 'unavailable', reason: 'npm audit request failed' });
  }
  return npmAuditReport(result.stdout, result.status);
}

function validateOsvResults(queries, payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.results) ||
      payload.results.length !== queries.length) {
    throw new TypeError('OSV audit response did not match the exact lockfile query');
  }
  const findings = [];
  payload.results.forEach((result, index) => {
    if (!result || typeof result !== 'object' ||
        (result.vulns !== undefined && !Array.isArray(result.vulns))) {
      throw new TypeError('OSV audit result is malformed');
    }
    for (const advisory of result.vulns || []) {
      const id = typeof advisory?.id === 'string' ? advisory.id : '';
      if (!id || id.length > 160 || /[\u0000-\u001f\u007f]/u.test(id)) {
        throw new TypeError('OSV advisory identity is malformed');
      }
      findings.push(Object.freeze({
        id,
        name: queries[index].package.name,
        version: queries[index].version,
      }));
    }
  });
  return Object.freeze(findings);
}

async function queryOsv(queries, { fetchImpl = globalThis.fetch, attempts = 3 } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) {
    throw new TypeError('OSV audit transport is invalid');
  }
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(OSV_BATCH_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response?.ok) throw new Error('OSV advisory service rejected the audit');
      return validateOsvResults(queries, await response.json());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw new Error('OSV advisory service was unavailable', { cause: lastError });
}

async function main() {
  const cwd = path.dirname(LOCK_PATH);
  const npm = runNpmAudit({ cwd });
  if (npm.kind === 'report') {
    if (!npm.passed) {
      throw new Error(`dependency audit failed: high=${npm.counts.high}, critical=${npm.counts.critical}`);
    }
    process.stdout.write(`dependency audit: PASS (npm, total=${npm.counts.total})\n`);
    return;
  }

  process.stderr.write(`npm audit unavailable (${npm.reason}); using strict OSV lockfile fallback\n`);
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  const queries = exactLockQueries(lock);
  const findings = await queryOsv(queries);
  if (findings.length) {
    const summary = findings.slice(0, 20)
      .map(({ name, version, id }) => `${name}@${version}:${id}`).join(', ');
    throw new Error(`dependency audit failed: ${findings.length} OSV finding(s): ${summary}`);
  }
  process.stdout.write(`dependency audit: PASS (OSV fallback, packages=${queries.length})\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message || 'dependency audit failed'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  exactLockQueries,
  npmAuditReport,
  packageNameFromLockPath,
  queryOsv,
  runNpmAudit,
  validateOsvResults,
};
