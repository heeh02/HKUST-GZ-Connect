'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MAX_SCANNED_FILE_BYTES = 2 * 1024 * 1024;
const SENSITIVE_PATTERNS = Object.freeze([
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['github-token', /\bghp_[A-Za-z0-9]{30,}\b/u],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/u],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/u],
  ['slack-bot-token', /\bxoxb-[0-9A-Za-z-]{20,}\b/u],
  ['openai-secret-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/u],
]);

function findSensitivePattern(text) {
  for (const [name, pattern] of SENSITIVE_PATTERNS) {
    if (pattern.test(String(text))) return name;
  }
  return null;
}

function trackedFiles(repositoryRoot) {
  const result = spawnSync('git', ['-C', repositoryRoot, 'ls-files', '-z'], {
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error('cannot enumerate tracked files for secret scanning');
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

function scanTrackedFiles(repositoryRoot) {
  const findings = [];
  for (const relative of trackedFiles(repositoryRoot)) {
    const file = path.join(repositoryRoot, relative);
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (!stat.isFile() || stat.size > MAX_SCANNED_FILE_BYTES) continue;
    let data;
    try { data = fs.readFileSync(file); } catch { continue; }
    if (data.includes(0)) continue;
    const pattern = findSensitivePattern(data.toString('utf8'));
    if (pattern) findings.push({ file: relative, pattern });
  }
  return findings;
}

function run() {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const findings = scanTrackedFiles(repositoryRoot);
  if (findings.length) {
    for (const finding of findings) {
      process.stderr.write(`secret gate: ${finding.pattern} in ${finding.file}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write('secret gate: PASS (tracked text files)\n');
}

if (require.main === module) run();

module.exports = {
  MAX_SCANNED_FILE_BYTES,
  SENSITIVE_PATTERNS,
  findSensitivePattern,
  scanTrackedFiles,
  trackedFiles,
};
