'use strict';

const fs = require('node:fs');
const path = require('node:path');

let temporarySequence = 0;

function fsyncDirectory(directory, fileSystem = fs) {
  let descriptor = null;
  try {
    descriptor = fileSystem.openSync(directory, 'r');
    fileSystem.fsyncSync?.(descriptor);
    return true;
  } catch {
    // Directory handles are not available on every Windows filesystem. The
    // private file itself is still fsynced before its atomic rename.
    return process.platform === 'win32';
  } finally {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
  }
}

function atomicWritePrivateFile(file, contents, fileSystem = fs, {
  protectTemporary = null,
  verifyCommitted = null,
  removeCommittedOnFailure = false,
} = {}) {
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${temporarySequence++}.tmp`,
  );
  let descriptor = null;
  let committed = false;
  try {
    fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
    descriptor = fileSystem.openSync(temporary, 'wx', 0o600);
    fileSystem.writeFileSync(descriptor, contents);
    if (typeof fileSystem.fsyncSync === 'function') fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    if (protectTemporary && protectTemporary(temporary) !== true) {
      throw new Error('could not protect temporary private file');
    }
    fileSystem.renameSync(temporary, file);
    committed = true;
    if (verifyCommitted && verifyCommitted(file) !== true) {
      throw new Error('could not verify committed private file');
    }
    if (!fsyncDirectory(directory, fileSystem)) {
      throw new Error('could not durably commit private file');
    }
    return true;
  } catch {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
    try { fileSystem.unlinkSync(temporary); } catch {}
    if (committed && removeCommittedOnFailure) {
      try { fileSystem.unlinkSync(file); } catch {}
    }
    return false;
  }
}

module.exports = { atomicWritePrivateFile, fsyncDirectory };
