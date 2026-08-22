'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const MAX_SCANNED_FILE_BYTES = 2 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;
const SENSITIVE_PATTERNS = Object.freeze([
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['github-token', /\bghp_[A-Za-z0-9]{30,}\b/u],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/u],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/u],
  ['slack-bot-token', /\bxoxb-[0-9A-Za-z-]{20,}\b/u],
  ['openai-secret-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/u],
]);

function decodedCandidates(value) {
  if (!Buffer.isBuffer(value)) return [String(value).normalize('NFKC')];
  return [value.toString('utf8').normalize('NFKC'), value.toString('latin1')];
}

function findSensitivePattern(value) {
  for (const text of decodedCandidates(value)) {
    for (const [name, pattern] of SENSITIVE_PATTERNS) {
      if (pattern.test(text)) return name;
    }
  }
  return null;
}

function runGit(repositoryRoot, args, { maxBuffer = MAX_GIT_OUTPUT_BYTES } = {}) {
  const result = spawnSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'buffer',
    maxBuffer,
  });
  if (result.error || result.status !== 0) {
    throw new Error('secret gate could not read the requested Git snapshot');
  }
  return result.stdout;
}

function safeDisplayPath(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/gu, '?').slice(0, 1024);
}

function parseIndexEntries(output) {
  return output.toString('utf8').split('\0').filter(Boolean).map((record) => {
    const match = /^(\d{6}) ([0-9a-f]{40,64}) ([0-3])\t([\s\S]+)$/u.exec(record);
    if (!match) throw new Error('secret gate received an invalid Git index entry');
    return { mode: match[1], object: match[2], stage: Number(match[3]), file: match[4] };
  });
}

function indexEntries(repositoryRoot) {
  return parseIndexEntries(runGit(repositoryRoot, ['ls-files', '--stage', '-z']));
}

function parseTreeEntries(output) {
  return output.toString('utf8').split('\0').filter(Boolean).map((record) => {
    const match = /^(\d{6}) ([a-z]+) ([0-9a-f]{40,64})\t([\s\S]+)$/u.exec(record);
    if (!match) throw new Error('secret gate received an invalid Git tree entry');
    return { mode: match[1], type: match[2], object: match[3], stage: 0, file: match[4] };
  });
}

function treeEntries(repositoryRoot, treeish) {
  if (typeof treeish !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z._/-]{0,127}$/u.test(treeish)) {
    throw new TypeError('secret gate tree identifier is invalid');
  }
  const tree = runGit(repositoryRoot, ['rev-parse', '--verify', `${treeish}^{tree}`])
    .toString('ascii').trim();
  if (!/^[0-9a-f]{40,64}$/u.test(tree)) throw new Error('secret gate tree could not be resolved');
  return parseTreeEntries(runGit(repositoryRoot, ['ls-tree', '-r', '-z', tree]));
}

function readGitBlob(repositoryRoot, object) {
  const size = Number(runGit(repositoryRoot, ['cat-file', '-s', object], { maxBuffer: 128 })
    .toString('ascii').trim());
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('secret gate blob size is invalid');
  if (size > MAX_SCANNED_FILE_BYTES) return { oversized: true, data: null };
  const data = runGit(repositoryRoot, ['cat-file', 'blob', object], {
    maxBuffer: MAX_SCANNED_FILE_BYTES + 1,
  });
  if (data.length !== size) throw new Error('secret gate blob changed while reading');
  return { oversized: false, data };
}

function scanGitEntries(repositoryRoot, entries, { readBlob = readGitBlob } = {}) {
  const findings = [];
  const conflicted = new Set();
  for (const entry of entries) {
    const file = safeDisplayPath(entry.file);
    if (entry.stage !== 0) {
      if (!conflicted.has(file)) findings.push({ file, pattern: 'index-conflict' });
      conflicted.add(file);
      continue;
    }
    if (entry.mode === '120000') {
      findings.push({ file, pattern: 'unsupported-symlink' });
      continue;
    }
    if (entry.mode === '160000' || (entry.type && entry.type !== 'blob')) {
      findings.push({ file, pattern: 'unsupported-git-entry' });
      continue;
    }
    const blob = readBlob(repositoryRoot, entry.object);
    if (blob.oversized) {
      findings.push({ file, pattern: 'oversized-unscanned-blob' });
      continue;
    }
    const pattern = findSensitivePattern(blob.data);
    if (pattern) findings.push({ file, pattern });
  }
  return findings;
}

function scanIndex(repositoryRoot) {
  return scanGitEntries(repositoryRoot, indexEntries(repositoryRoot));
}

function scanTree(repositoryRoot, treeish) {
  return scanGitEntries(repositoryRoot, treeEntries(repositoryRoot, treeish));
}

function run(argv = process.argv.slice(2)) {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  let findings;
  let scope = 'Git index';
  const treeIndex = argv.indexOf('--tree');
  if (treeIndex !== -1) {
    if (argv.length !== 2 || treeIndex !== 0) throw new TypeError('secret gate arguments are invalid');
    findings = scanTree(repositoryRoot, argv[1]);
    scope = `tree ${argv[1]}`;
  } else {
    if (argv.length && !(argv.length === 1 && argv[0] === '--staged')) {
      throw new TypeError('secret gate arguments are invalid');
    }
    findings = scanIndex(repositoryRoot);
  }
  if (findings.length) {
    for (const finding of findings) {
      process.stderr.write(`secret gate: ${finding.pattern} in ${finding.file}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`secret gate: PASS (${scope})\n`);
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`secret gate: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  MAX_SCANNED_FILE_BYTES,
  SENSITIVE_PATTERNS,
  findSensitivePattern,
  indexEntries,
  parseIndexEntries,
  parseTreeEntries,
  scanGitEntries,
  scanIndex,
  scanTree,
  treeEntries,
};
