'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('../../platform/storage/atomic-private-file');
const { readPrivateFileBounded } = require('../../platform/storage/private-file');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('../../platform/storage/windows-private-file');
const {
  emptyFavoriteResourceDocument,
  emptyRecentResourceDocument,
  validateFavoriteResourceDocument,
  validateRecentResourceDocument,
} = require('../schema/resource-activity-contract');
const {
  recordRecentResource,
  toggleFavoriteResource,
} = require('./resource-activity');

const MAX_RESOURCE_ACTIVITY_BYTES = 32 * 1024;

function normalizedFile(value, name) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value ||
      value === path.parse(value).root) {
    throw new TypeError(`${name} path is invalid`);
  }
  return value;
}

function storageOptions(platform, windowsAcl) {
  return platform === 'win32' ? {
    protectTemporary: (file) => windowsAcl.protect(file) === true,
    verifyCommitted: (file) => windowsAcl.verify(file) === true,
    removeCommittedOnFailure: true,
  } : {};
}

class ResourceActivityStore {
  constructor({
    favoritesFile,
    recentFile,
    fileSystem = fs,
    platform = process.platform,
    windowsAcl = {
      protect: protectWindowsFileOwnerOnly,
      verify: verifyWindowsFileOwnerOnly,
    },
    now = Date.now,
  } = {}) {
    if (!fileSystem || typeof fileSystem.openSync !== 'function' ||
        !['darwin', 'linux', 'win32'].includes(platform) || typeof now !== 'function' ||
        (platform === 'win32' && (typeof windowsAcl?.protect !== 'function' ||
          typeof windowsAcl?.verify !== 'function'))) {
      throw new TypeError('resource activity store dependencies are invalid');
    }
    this.favoritesFile = normalizedFile(favoritesFile, 'favorites');
    this.recentFile = normalizedFile(recentFile, 'recent resources');
    if (this.favoritesFile === this.recentFile) {
      throw new TypeError('resource activity paths must be distinct');
    }
    this.fileSystem = fileSystem;
    this.platform = platform;
    this.windowsAcl = windowsAcl;
    this.now = now;
  }

  snapshot() {
    return Object.freeze({
      favorites: this.#read(
        this.favoritesFile,
        validateFavoriteResourceDocument,
        emptyFavoriteResourceDocument,
      ),
      recent: this.#read(
        this.recentFile,
        validateRecentResourceDocument,
        emptyRecentResourceDocument,
      ),
    });
  }

  toggleFavorite(resourceId, resources) {
    const current = this.#read(
      this.favoritesFile,
      validateFavoriteResourceDocument,
      emptyFavoriteResourceDocument,
    );
    const next = toggleFavoriteResource(current, resourceId, resources);
    this.#write(this.favoritesFile, next);
    return next;
  }

  replaceFavorites(document) {
    const next = validateFavoriteResourceDocument(document);
    this.#write(this.favoritesFile, next);
    return next;
  }

  recordOpen(resourceId, resources) {
    const current = this.#read(
      this.recentFile,
      validateRecentResourceDocument,
      emptyRecentResourceDocument,
    );
    const next = recordRecentResource(current, resourceId, this.now(), resources);
    this.#write(this.recentFile, next);
    return next;
  }

  #read(file, validate, empty) {
    try { this.fileSystem.lstatSync(file); }
    catch (error) {
      if (error?.code === 'ENOENT') return empty();
      throw error;
    }
    if (this.platform === 'win32' && !this.windowsAcl.verify(file)) {
      throw new Error('resource activity ACL is invalid');
    }
    let data;
    try {
      ({ data } = readPrivateFileBounded(file, {
        maxBytes: MAX_RESOURCE_ACTIVITY_BYTES,
        minBytes: 2,
        platform: this.platform,
        fileSystem: this.fileSystem,
      }));
      return validate(JSON.parse(data.toString('utf8')));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('resource activity document is invalid', { cause: error });
      }
      throw error;
    } finally {
      data?.fill(0);
    }
  }

  #write(file, document) {
    const data = Buffer.from(`${JSON.stringify(document)}\n`, 'utf8');
    try {
      if (data.length > MAX_RESOURCE_ACTIVITY_BYTES || !atomicWritePrivateFile(
        file,
        data,
        this.fileSystem,
        storageOptions(this.platform, this.windowsAcl),
      )) {
        throw new Error('resource activity write failed');
      }
      return true;
    } finally {
      data.fill(0);
    }
  }
}

module.exports = { MAX_RESOURCE_ACTIVITY_BYTES, ResourceActivityStore };
