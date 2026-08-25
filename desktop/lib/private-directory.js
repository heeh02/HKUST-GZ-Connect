'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizedRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value ||
      value === path.parse(value).root) {
    throw new TypeError('private directory root is invalid');
  }
  return value;
}

function ensurePrivateDirectoryChain(rootValue, directoryValue, {
  fileSystem = fs,
  platform = process.platform,
} = {}) {
  const root = normalizedRoot(rootValue);
  if (typeof directoryValue !== 'string' || !path.isAbsolute(directoryValue) ||
      path.resolve(directoryValue) !== directoryValue) {
    throw new TypeError('private directory target is invalid');
  }
  const relative = path.relative(root, directoryValue);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError('private directory escapes its root');
  }
  try { fileSystem.mkdirSync(root, { recursive: true, mode: 0o700 }); }
  catch (error) { throw new Error('private directory root could not be created', { cause: error }); }
  let current = root;
  for (const component of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    let stat;
    try { stat = fileSystem.lstatSync(current); }
    catch (error) {
      if (error?.code !== 'ENOENT' || !component) throw error;
      fileSystem.mkdirSync(current, { mode: 0o700 });
      stat = fileSystem.lstatSync(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        (platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
      throw new Error('private directory is not owner-only and link-free');
    }
  }
  return true;
}

function fsyncPrivateDirectory(directory, fileSystem = fs, platform = process.platform) {
  let descriptor = null;
  try {
    descriptor = fileSystem.openSync(directory, 'r');
    fileSystem.fsyncSync?.(descriptor);
    return true;
  } catch {
    return platform === 'win32';
  } finally {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
  }
}

module.exports = { ensurePrivateDirectoryChain, fsyncPrivateDirectory };
