'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const COPY_BUFFER_BYTES = 64 * 1024;
const NO_FOLLOW = fs.constants.O_NOFOLLOW || 0;
const DIRECTORY_ONLY = fs.constants.O_DIRECTORY || 0;

function unsafeLogPath(file, reason) {
  const error = new Error(`Unsafe log path ${file}: ${reason}`);
  error.code = 'ERR_UNSAFE_LOG_PATH';
  return error;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function requireCurrentOwner(stat, file) {
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw unsafeLogPath(file, 'not owned by the current user');
  }
}

function requireRegularSingleLink(stat, file) {
  if (!stat.isFile() || stat.isSymbolicLink?.()) {
    throw unsafeLogPath(file, 'not a regular file');
  }
  // A writable hard link can modify an unrelated inode even when O_NOFOLLOW is
  // used. Logs created by this module always have exactly one directory entry.
  if (process.platform !== 'win32' && stat.nlink !== 1) {
    throw unsafeLogPath(file, 'has multiple hard links');
  }
  requireCurrentOwner(stat, file);
}

async function lstatOrNull(file) {
  try {
    return await fs.promises.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensurePrivateDirectory(file) {
  const directory = path.dirname(file);
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });

  const before = await fs.promises.lstat(directory);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw unsafeLogPath(directory, 'parent is not a real directory');
  }
  requireCurrentOwner(before, directory);

  // Verify the final directory through a no-follow descriptor without changing
  // permissions on an existing caller-owned directory. Node has no portable
  // openat/renameat, so path operations also re-check the final file inode.
  if (process.platform !== 'win32') {
    let handle;
    try {
      handle = await fs.promises.open(
        directory,
        fs.constants.O_RDONLY | DIRECTORY_ONLY | NO_FOLLOW,
      );
      const opened = await handle.stat();
      if (!opened.isDirectory() || !sameFile(before, opened)) {
        throw unsafeLogPath(directory, 'parent changed while opening');
      }
      requireCurrentOwner(opened, directory);
      const after = await fs.promises.lstat(directory);
      if (!after.isDirectory() || after.isSymbolicLink() || !sameFile(opened, after)) {
        throw unsafeLogPath(directory, 'parent changed while securing');
      }
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  return directory;
}

async function fsyncDirectory(directory) {
  if (process.platform === 'win32') return;
  let handle;
  try {
    handle = await fs.promises.open(
      directory,
      fs.constants.O_RDONLY | DIRECTORY_ONLY | NO_FOLLOW,
    );
    const stat = await handle.stat();
    if (!stat.isDirectory()) throw unsafeLogPath(directory, 'not a directory');
    requireCurrentOwner(stat, directory);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function secureOpenedFile(handle, file, before) {
  const opened = await handle.stat();
  requireRegularSingleLink(opened, file);
  if (before && !sameFile(before, opened)) {
    throw unsafeLogPath(file, 'changed while opening');
  }

  const after = await fs.promises.lstat(file);
  if (after.isSymbolicLink() || !after.isFile() || !sameFile(opened, after)) {
    throw unsafeLogPath(file, 'changed while opening');
  }
  requireRegularSingleLink(after, file);

  if (process.platform !== 'win32') {
    await handle.chmod(0o600);
    const secured = await handle.stat();
    if ((secured.mode & 0o777) !== 0o600 || !sameFile(opened, secured)) {
      throw unsafeLogPath(file, 'could not enforce owner-only permissions');
    }
  }
  return opened;
}

async function openVerifiedRegular(file, flags, { create = false } = {}) {
  const before = await lstatOrNull(file);
  if (before) {
    if (before.isSymbolicLink()) throw unsafeLogPath(file, 'symbolic link rejected');
    requireRegularSingleLink(before, file);
  } else if (!create) {
    const error = new Error(`Log file does not exist: ${file}`);
    error.code = 'ENOENT';
    throw error;
  }

  let handle;
  try {
    handle = await fs.promises.open(
      file,
      flags | NO_FOLLOW | (create ? fs.constants.O_CREAT : 0),
      0o600,
    );
    const stat = await secureOpenedFile(handle, file, before);
    return { handle, stat };
  } catch (error) {
    await handle?.close().catch(() => {});
    throw error;
  }
}

async function recheckOpenPath(file, handle, expected) {
  const opened = await handle.stat();
  const current = await fs.promises.lstat(file);
  if (
    !opened.isFile()
    || current.isSymbolicLink()
    || !current.isFile()
    || !sameFile(expected, opened)
    || !sameFile(opened, current)
  ) {
    throw unsafeLogPath(file, 'changed during operation');
  }
  requireRegularSingleLink(opened, file);
}

async function createPrivateTemp(target) {
  const directory = path.dirname(target);
  const basename = path.basename(target);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const temp = path.join(
      directory,
      `.${basename}.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`,
    );
    let handle;
    try {
      handle = await fs.promises.open(
        temp,
        fs.constants.O_WRONLY
          | fs.constants.O_CREAT
          | fs.constants.O_EXCL
          | NO_FOLLOW,
        0o600,
      );
      const stat = await secureOpenedFile(handle, temp, null);
      return { handle, stat, temp };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw unsafeLogPath(target, 'could not allocate a private temporary file');
}

async function renameReplacingEntry(temp, target) {
  try {
    await fs.promises.rename(temp, target);
  } catch (error) {
    // POSIX rename atomically replaces a file or symbolic-link entry without
    // dereferencing it. Windows requires unlinking the entry first.
    if (
      process.platform !== 'win32'
      || !['EEXIST', 'EPERM', 'EACCES'].includes(error.code)
    ) {
      throw error;
    }
    const existing = await lstatOrNull(target);
    if (existing) {
      if (existing.isDirectory() && !existing.isSymbolicLink()) {
        throw unsafeLogPath(target, 'refusing to replace a directory');
      }
      await fs.promises.unlink(target);
    }
    await fs.promises.rename(temp, target);
  }
}

async function replaceWithPrivateFile(target, write) {
  const directory = await ensurePrivateDirectory(target);
  const temporary = await createPrivateTemp(target);
  let committed = false;
  try {
    await write(temporary.handle);
    await temporary.handle.sync();
    if (process.platform !== 'win32') await temporary.handle.chmod(0o600);
    await recheckOpenPath(temporary.temp, temporary.handle, temporary.stat);
    await temporary.handle.close();
    temporary.handle = null;

    await renameReplacingEntry(temporary.temp, target);
    committed = true;
    await fsyncDirectory(directory);

    const verified = await openVerifiedRegular(target, fs.constants.O_RDONLY);
    try {
      if (!sameFile(temporary.stat, verified.stat)) {
        throw unsafeLogPath(target, 'replacement changed before verification');
      }
    } finally {
      await verified.handle.close();
    }
  } finally {
    await temporary.handle?.close().catch(() => {});
    if (!committed) await fs.promises.unlink(temporary.temp).catch(() => {});
  }
}

async function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, null);
    if (bytesWritten <= 0) throw new Error('Unable to make progress writing log file');
    offset += bytesWritten;
  }
}

async function copyTail(source, sourceSize, destination, maxBytes) {
  const length = Math.min(sourceSize, maxBytes);
  let position = sourceSize - length;
  let remaining = length;
  const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, Math.max(1, length)));
  while (remaining > 0) {
    const requested = Math.min(buffer.length, remaining);
    const { bytesRead } = await source.read(buffer, 0, requested, position);
    if (bytesRead <= 0) break;
    await writeAll(destination, buffer.subarray(0, bytesRead));
    position += bytesRead;
    remaining -= bytesRead;
  }
}

module.exports = {
  copyTail,
  ensurePrivateDirectory,
  openVerifiedRegular,
  recheckOpenPath,
  replaceWithPrivateFile,
  unsafeLogPath,
  writeAll,
};
