'use strict';

const fs = require('fs');
const path = require('path');
const { domainToASCII } = require('node:url');
const { ensureOwnerOnly } = require('../../platform/storage/private-file');
const { ROUTE_CAMPUS, ROUTE_DIRECT } = require('../policy/campus-route');
const { isIsolatedNetworkHost } = require('../policy/host-safety');

const RULE_FILE_VERSION = 1;
const MAX_ROUTING_RULES = 128;
const MAX_HOST_LENGTH = 253;
const MAX_ROUTING_TARGET_LENGTH = 2048;
const MAX_ROUTING_DOCUMENT_BYTES = 512 * 1024;
let temporarySequence = 0;

function fsyncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    // Windows directory handles are not portable. The JSON file itself is
    // still fsynced before its same-directory atomic rename.
    if (process.platform !== 'win32') throw error;
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function invalidHost() {
  return new Error('路由规则域名无效');
}

function normalizeRuleHost(value) {
  if (typeof value !== 'string') throw invalidHost();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_HOST_LENGTH + 1) throw invalidHost();
  if (
    /[\u0000-\u0020\u007f]/u.test(trimmed)
    || /[:/@*?#\\]/u.test(trimmed)
    || trimmed.startsWith('.')
    || trimmed.endsWith('..')
  ) {
    throw invalidHost();
  }

  const withoutRootDot = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  const ascii = domainToASCII(withoutRootDot).toLowerCase();
  if (!ascii || ascii.length > MAX_HOST_LENGTH || ascii.includes('..')) throw invalidHost();

  const labels = ascii.split('.');
  if (labels.some((label) => (
    !label
    || label.length > 63
    || !/^[a-z0-9-]+$/u.test(label)
    || label.startsWith('-')
    || label.endsWith('-')
  ))) {
    throw invalidHost();
  }
  return ascii;
}

function normalizeRoutingTarget(value) {
  const invalid = () => {
    const error = new TypeError('网站地址或域名无效');
    error.code = 'ROUTING_TARGET_INVALID';
    return error;
  };
  if (typeof value !== 'string') throw invalid();
  const input = value.trim();
  if (!input || input.length > MAX_ROUTING_TARGET_LENGTH ||
      /[\u0000-\u0020\u007f]/u.test(input) || input.includes('*')) throw invalid();
  const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(input) ||
    /^(?:data|file|ftp|javascript|mailto):/iu.test(input);
  const candidate = input.startsWith('//') ? `https:${input}`
    : explicitScheme ? input : `https://${input}`;
  let parsed;
  try { parsed = new URL(candidate); } catch { throw invalid(); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname ||
      parsed.username || parsed.password) throw invalid();
  let host;
  try { host = normalizeRuleHost(parsed.hostname); } catch { throw invalid(); }
  return Object.freeze({
    host,
    inputKind: explicitScheme || input.startsWith('//') || /[/?#]/u.test(input)
      ? 'url' : 'host',
    discardedPort: parsed.port !== '',
    discardedPath: parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '',
  });
}

function validRoute(route) {
  return route === ROUTE_CAMPUS || route === ROUTE_DIRECT;
}

function normalizedRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!validRoute(value.route) || typeof value.includeSubdomains !== 'boolean') return null;
  const updatedAt = Number(value.updatedAt);
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) return null;
  try {
    const host = normalizeRuleHost(value.host);
    return {
      host,
      includeSubdomains: value.includeSubdomains,
      // Older releases could persist a DIRECT rule for a local/private host.
      // Migrate it at the storage boundary so the UI resolver and PAC can
      // never disagree about the effective route.
      route: value.route === ROUTE_DIRECT && isIsolatedNetworkHost(host)
        ? ROUTE_CAMPUS
        : value.route,
      updatedAt,
    };
  } catch {
    return null;
  }
}

function normalizeRoutingRules(value) {
  if (!Array.isArray(value)) return [];
  const byIdentity = new Map();
  for (const candidate of value) {
    const rule = normalizedRecord(candidate);
    if (!rule) continue;
    const identity = `${rule.host}\u0000${rule.includeSubdomains ? 'subdomains' : 'exact'}`;
    const previous = byIdentity.get(identity);
    if (!previous || rule.updatedAt >= previous.updatedAt) byIdentity.set(identity, rule);
  }
  return [...byIdentity.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt || left.host.localeCompare(right.host))
    .slice(0, MAX_ROUTING_RULES);
}

function loadRoutingRules(filePath) {
  let descriptor = null;
  try {
    const before = fs.lstatSync(filePath);
    if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 ||
        before.size > MAX_ROUTING_DOCUMENT_BYTES ||
        (process.platform !== 'win32' && before.nlink !== 1) ||
        (process.platform !== 'win32' && (before.mode & 0o077) !== 0)) return [];
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== before.size || opened.size > MAX_ROUTING_DOCUMENT_BYTES ||
        (process.platform !== 'win32' && opened.nlink !== 1)) return [];
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    if (offset !== bytes.length) throw new Error('路由规则文件读取不完整');
    const document = JSON.parse(bytes.toString('utf8'));
    if (!document || document.version !== RULE_FILE_VERSION || !Array.isArray(document.rules)) {
      return [];
    }
    return normalizeRoutingRules(document.rules);
  } catch (error) {
    // Definite absence and malformed JSON are safe empty states. Permission,
    // I/O, descriptor and short-read failures must propagate so an upsert
    // cannot overwrite an unread but still-authoritative rule document.
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return [];
    throw error;
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function saveRoutingRules(filePath, rules) {
  const normalized = normalizeRoutingRules(rules);
  const directory = path.dirname(filePath);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${temporarySequence++}.tmp`,
  );
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(
      descriptor,
      JSON.stringify({ version: RULE_FILE_VERSION, rules: normalized }, null, 2),
      'utf8',
    );
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, filePath);
    ensureOwnerOnly(filePath);
    try {
      fsyncDirectory(directory);
    } catch (error) {
      // The primary rename is already visible. Mark the commit point so the
      // higher-level JSON/PAC transaction rolls it back before reactivating.
      error.commitApplied = true;
      throw error;
    }
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {}
  }
  return normalized;
}

function upsertRoutingRule(currentRules, payload, now = Date.now()) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const rule = {
    host: normalizeRuleHost(source.host),
    includeSubdomains: source.includeSubdomains === true,
    route: source.route,
    updatedAt: Number(now),
  };
  if (!validRoute(rule.route) || !Number.isSafeInteger(rule.updatedAt) || rule.updatedAt < 0) {
    throw new Error('路由规则无效');
  }
  if (rule.route === ROUTE_DIRECT && isIsolatedNetworkHost(rule.host)) {
    throw new Error('本机、私网和特殊地址不能设为直连');
  }
  const current = normalizeRoutingRules(currentRules).filter((candidate) => !(
    candidate.host === rule.host
    && candidate.includeSubdomains === rule.includeSubdomains
  ));
  return { rule, rules: normalizeRoutingRules([rule, ...current]) };
}

function deleteRoutingRule(currentRules, host, includeSubdomains = false) {
  const normalizedHost = normalizeRuleHost(host);
  const scope = includeSubdomains === true;
  return normalizeRoutingRules(currentRules).filter((rule) => !(
    rule.host === normalizedHost && rule.includeSubdomains === scope
  ));
}

module.exports = {
  MAX_ROUTING_RULES,
  MAX_ROUTING_DOCUMENT_BYTES,
  MAX_ROUTING_TARGET_LENGTH,
  RULE_FILE_VERSION,
  deleteRoutingRule,
  fsyncDirectory,
  loadRoutingRules,
  normalizeRoutingRules,
  normalizeRuleHost,
  normalizeRoutingTarget,
  saveRoutingRules,
  upsertRoutingRule,
};
