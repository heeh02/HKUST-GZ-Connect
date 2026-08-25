'use strict';

const fs = require('fs');

const MAX_PRIVATE_READ_BYTES = 64 * 1024 * 1024;

function readPrivateFileBounded(file, {
  maxBytes,
  minBytes = 1,
  platform = process.platform,
  fileSystem = fs,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PRIVATE_READ_BYTES ||
      !Number.isSafeInteger(minBytes) || minBytes < 0 || minBytes > maxBytes) {
    throw new TypeError('invalid private-file read bound');
  }
  let descriptor = null;
  try {
    const before = fileSystem.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size < minBytes ||
        before.size > maxBytes ||
        (platform !== 'win32' && before.nlink !== 1) ||
        (platform !== 'win32' && (before.mode & 0o077) !== 0)) {
      const error = new Error('invalid private file');
      error.privateFileInvalid = true;
      throw error;
    }
    const constants = fileSystem.constants || fs.constants;
    descriptor = fileSystem.openSync(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    const opened = fileSystem.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== before.size || opened.size < minBytes || opened.size > maxBytes ||
        (platform !== 'win32' && opened.nlink !== 1)) {
      const error = new Error('private file changed while opening');
      error.privateFileInvalid = true;
      throw error;
    }
    const data = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < data.length) {
      const count = fileSystem.readSync(
        descriptor,
        data,
        offset,
        data.length - offset,
        offset,
      );
      if (!count) break;
      offset += count;
    }
    if (offset !== data.length) {
      const error = new Error('private file read was incomplete');
      error.code = 'EIO';
      throw error;
    }
    return { data, stat: opened };
  } finally {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
  }
}

function ensureOwnerOnly(file) {
  let descriptor = null;
  try {
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() ||
        (process.platform !== 'win32' && before.nlink !== 1)) return false;
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    // The descriptor, rather than the path, owns the permission change. The
    // inode comparison also catches a path replacement between lstat/open on
    // platforms where O_NOFOLLOW is unavailable.
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        (process.platform !== 'win32' && opened.nlink !== 1)) return false;
    fs.fchmodSync(descriptor, 0o600);
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

module.exports = {
  MAX_PRIVATE_READ_BYTES,
  ensureOwnerOnly,
  readPrivateFileBounded,
};
