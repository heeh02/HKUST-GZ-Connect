'use strict';

const fs = require('fs');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('./windows-private-file');

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

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs;
}

function ensureOwnerOnly(file, {
  fileSystem = fs,
  platform = process.platform,
  windowsAcl = {
    protect: protectWindowsFileOwnerOnly,
    verify: verifyWindowsFileOwnerOnly,
  },
} = {}) {
  let descriptor = null;
  try {
    if (!['darwin', 'linux', 'win32'].includes(platform) ||
        (platform === 'win32' && (typeof windowsAcl?.protect !== 'function' ||
          typeof windowsAcl?.verify !== 'function'))) return false;
    const before = fileSystem.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() ||
        (Number.isSafeInteger(before.nlink) && before.nlink !== 1)) return false;
    const constants = fileSystem.constants || fs.constants;
    const noFollow = constants.O_NOFOLLOW || 0;
    descriptor = fileSystem.openSync(file, constants.O_RDONLY | noFollow);
    const opened = fileSystem.fstatSync(descriptor);
    // The descriptor, rather than the path, owns the permission change. The
    // inode comparison also catches a path replacement between lstat/open on
    // platforms where O_NOFOLLOW is unavailable.
    if (!opened.isFile() || !sameFileIdentity(opened, before) ||
        (Number.isSafeInteger(opened.nlink) && opened.nlink !== 1)) return false;
    if (platform === 'win32') {
      // Older releases created these files as the current user but could leave
      // inherited Windows access rules in place. Tightening is allowed only
      // after the PowerShell boundary proves the current SID already owns the
      // exact regular path; it never takes ownership of a foreign file.
      if (!windowsAcl.protect(file) || !windowsAcl.verify(file)) return false;
      const after = fileSystem.lstatSync(file);
      return after.isFile() && !after.isSymbolicLink() &&
        sameFileIdentity(after, opened) &&
        (!Number.isSafeInteger(after.nlink) || after.nlink === 1);
    }
    fileSystem.fchmodSync(descriptor, 0o600);
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
  }
}

module.exports = {
  MAX_PRIVATE_READ_BYTES,
  ensureOwnerOnly,
  readPrivateFileBounded,
};
