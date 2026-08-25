'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ensureOwnerOnly } = require('../../platform/storage/private-file');

const MAX_PAC_BYTES = 512 * 1024;
let temporarySequence = 0;

function fsyncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    // Windows commonly refuses directory handles. The PAC file itself is
    // still fsynced before its same-directory atomic rename.
    if (process.platform !== 'win32') throw error;
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function savePacFile(filePath, source) {
  if (typeof source !== 'string' || !source || Buffer.byteLength(source) > MAX_PAC_BYTES) {
    throw new Error('PAC 文件内容无效');
  }
  const directory = path.dirname(filePath);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${temporarySequence++}.tmp`,
  );
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, source, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, filePath);
    ensureOwnerOnly(filePath);
    try {
      fsyncDirectory(directory);
    } catch (error) {
      // The rename already happened. Callers that coordinate multiple files
      // can distinguish a committed-but-not-confirmed directory entry.
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
  const revision = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  const url = new URL(pathToFileURL(filePath));
  url.searchParams.set('v', revision);
  return { filePath, revision, url: url.href };
}

module.exports = { MAX_PAC_BYTES, fsyncDirectory, savePacFile };
