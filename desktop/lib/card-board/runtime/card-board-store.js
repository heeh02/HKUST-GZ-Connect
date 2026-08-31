'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('../../platform/storage/atomic-private-file');
const { readPrivateFileBounded } = require('../../platform/storage/private-file');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('../../platform/storage/windows-private-file');
const { validateCardBoardLayoutDocument } = require('../schema/card-board-contract');

const MAX_CARD_BOARD_DOCUMENT_BYTES = 256 * 1024;

function storageOptions(platform, windowsAcl) {
  return platform === 'win32' ? {
    protectTemporary: (file) => windowsAcl.protect(file) === true,
    verifyCommitted: (file) => windowsAcl.verify(file) === true,
    removeCommittedOnFailure: true,
  } : {};
}

class CardBoardStore {
  constructor({
    filePath,
    fileSystem = fs,
    platform = process.platform,
    windowsAcl = {
      protect: protectWindowsFileOwnerOnly,
      verify: verifyWindowsFileOwnerOnly,
    },
  } = {}) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) ||
        path.resolve(filePath) !== filePath || !fileSystem ||
        typeof fileSystem.openSync !== 'function' ||
        !['darwin', 'linux', 'win32'].includes(platform) ||
        (platform === 'win32' && (typeof windowsAcl?.protect !== 'function' ||
          typeof windowsAcl?.verify !== 'function'))) {
      throw new TypeError('card board store dependencies are invalid');
    }
    this.filePath = filePath;
    this.fileSystem = fileSystem;
    this.platform = platform;
    this.windowsAcl = windowsAcl;
  }

  read() {
    try { this.fileSystem.lstatSync(this.filePath); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (this.platform === 'win32' && !this.windowsAcl.verify(this.filePath)) {
      throw new Error('card board document ACL is invalid');
    }
    let data;
    try {
      ({ data } = readPrivateFileBounded(this.filePath, {
        maxBytes: MAX_CARD_BOARD_DOCUMENT_BYTES,
        minBytes: 2,
        platform: this.platform,
        fileSystem: this.fileSystem,
      }));
      return validateCardBoardLayoutDocument(JSON.parse(data.toString('utf8')));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('card board document is invalid', { cause: error });
      }
      throw error;
    } finally {
      data?.fill(0);
    }
  }

  replace(document) {
    const normalized = validateCardBoardLayoutDocument(document);
    const data = Buffer.from(`${JSON.stringify(normalized)}\n`, 'utf8');
    try {
      if (data.length > MAX_CARD_BOARD_DOCUMENT_BYTES ||
          !atomicWritePrivateFile(
            this.filePath,
            data,
            this.fileSystem,
            storageOptions(this.platform, this.windowsAcl),
          )) {
        throw new Error('card board document write failed');
      }
      return normalized;
    } finally {
      data.fill(0);
    }
  }
}

module.exports = {
  CardBoardStore,
  MAX_CARD_BOARD_DOCUMENT_BYTES,
};
