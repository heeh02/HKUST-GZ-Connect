'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWritePrivateFile } = require('../credential-store');
const { ensurePrivateDirectoryChain } = require('../private-directory');
const { readPrivateFileBounded } = require('../private-file');
const {
  INTEGRATION_SCHEMA_VERSION,
  validateIntegrationRecord,
  validateIntegrationRecordDocument,
} = require('./integration-schema');
const {
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
} = require('../windows-private-file');

const MAX_INTEGRATION_RECORD_BYTES = 1024 * 1024;

function receipt(data) {
  if (data === null) return Object.freeze({ present: false, bytes: 0, sha256: null });
  return Object.freeze({
    present: true,
    bytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
  });
}

function sameReceipt(left, right) {
  return Boolean(left && right && left.present === right.present && left.bytes === right.bytes &&
    left.sha256 === right.sha256);
}

function identity(record) {
  return `${record.adapterId}\0${record.profileId}\0${record.managedBlockId}`;
}

function serialize(value) {
  const data = Buffer.from(`${JSON.stringify(validateIntegrationRecordDocument(value))}\n`, 'utf8');
  if (data.length < 2 || data.length > MAX_INTEGRATION_RECORD_BYTES) {
    data.fill(0);
    throw new TypeError('integration records exceed their storage bound');
  }
  return data;
}

function upsert(document, recordValue) {
  const current = validateIntegrationRecordDocument(document);
  const record = validateIntegrationRecord(recordValue);
  const key = identity(record);
  return validateIntegrationRecordDocument({
    schemaVersion: INTEGRATION_SCHEMA_VERSION,
    records: [...current.records.filter((candidate) => identity(candidate) !== key), record],
  });
}

function remove(document, recordValue) {
  const current = validateIntegrationRecordDocument(document);
  const record = validateIntegrationRecord(recordValue);
  const key = identity(record);
  return validateIntegrationRecordDocument({
    schemaVersion: INTEGRATION_SCHEMA_VERSION,
    records: current.records.filter((candidate) => identity(candidate) !== key),
  });
}

class IntegrationRecordStore {
  constructor({
    workspaceRoot,
    filePath,
    fileSystem = fs,
    platform = process.platform,
    windowsAcl = {
      protect: protectWindowsFileOwnerOnly,
      verify: verifyWindowsFileOwnerOnly,
    },
  } = {}) {
    if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot) ||
        path.resolve(workspaceRoot) !== workspaceRoot || workspaceRoot === path.parse(workspaceRoot).root ||
        typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.resolve(filePath) !== filePath ||
        !fileSystem || typeof fileSystem.openSync !== 'function' ||
        !['darwin', 'linux', 'win32'].includes(platform) ||
        (platform === 'win32' && (typeof windowsAcl?.protect !== 'function' ||
          typeof windowsAcl?.verify !== 'function'))) {
      throw new TypeError('integration record store dependencies are invalid');
    }
    const relative = path.relative(workspaceRoot, filePath);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
      throw new TypeError('integration record file escapes its workspace');
    }
    this.workspaceRoot = workspaceRoot;
    this.filePath = filePath;
    this.fileSystem = fileSystem;
    this.platform = platform;
    this.windowsAcl = windowsAcl;
  }

  read() {
    const current = this.#readCurrent();
    try { return current.document; }
    finally { current.data?.fill(0); }
  }

  planUpsert(recordValue) {
    return this.#plan((document) => upsert(document, recordValue), [recordValue]);
  }

  planRemove(recordValue) {
    return this.#plan((document) => remove(document, recordValue), [recordValue]);
  }

  planUpserts(recordValues) {
    const records = this.#records(recordValues);
    return this.#plan(
      (document) => records.reduce((current, record) => upsert(current, record), document),
      records,
    );
  }

  planRemovals(recordValues) {
    const records = this.#records(recordValues);
    return this.#plan(
      (document) => records.reduce((current, record) => remove(current, record), document),
      records,
    );
  }

  apply(plan) {
    if (!plan || typeof plan !== 'object' || !plan.before || !plan.after || !plan.document) {
      throw new TypeError('integration record transition is invalid');
    }
    const next = validateIntegrationRecordDocument(plan.document);
    const current = this.#readCurrent();
    let data = null;
    try {
      const observed = receipt(current.data);
      if (sameReceipt(observed, plan.after)) return true;
      if (!sameReceipt(observed, plan.before)) {
        throw new Error('integration records changed before commit');
      }
      data = serialize(next);
      if (!sameReceipt(receipt(data), plan.after)) {
        throw new Error('integration record transition digest drifted');
      }
      ensurePrivateDirectoryChain(this.workspaceRoot, path.dirname(this.filePath), {
        fileSystem: this.fileSystem,
        platform: this.platform,
      });
      const options = this.platform === 'win32' ? {
        protectTemporary: (file) => this.windowsAcl.protect(file) === true,
        verifyCommitted: (file) => this.windowsAcl.verify(file) === true,
        removeCommittedOnFailure: true,
      } : {};
      if (!atomicWritePrivateFile(this.filePath, data, this.fileSystem, options)) {
        throw new Error('integration record commit failed');
      }
      const verified = this.#readCurrent();
      try {
        if (!sameReceipt(receipt(verified.data), plan.after)) {
          throw new Error('integration record readback failed');
        }
      } finally { verified.data?.fill(0); }
      return true;
    } finally {
      current.data?.fill(0);
      data?.fill(0);
    }
  }

  #plan(mutator, recordValues) {
    if (typeof mutator !== 'function') throw new TypeError('integration record mutator is invalid');
    const records = this.#records(recordValues);
    const current = this.#readCurrent();
    let after = null;
    try {
      const document = mutator(current.document);
      after = serialize(document);
      return Object.freeze({
        record: records.length === 1 ? records[0] : null,
        records,
        before: receipt(current.data),
        after: receipt(after),
        document,
      });
    } finally {
      current.data?.fill(0);
      after?.fill(0);
    }
  }

  #records(value) {
    if (!Array.isArray(value) || !value.length || value.length > 8) {
      throw new TypeError('integration record transition must be a bounded non-empty array');
    }
    return Object.freeze(value.map(validateIntegrationRecord));
  }

  #readCurrent() {
    try { this.fileSystem.lstatSync(this.filePath); }
    catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          data: null,
          document: validateIntegrationRecordDocument({
            schemaVersion: INTEGRATION_SCHEMA_VERSION,
            records: [],
          }),
        };
      }
      throw error;
    }
    if (this.platform === 'win32' && !this.windowsAcl.verify(this.filePath)) {
      throw new Error('integration record ACL is invalid');
    }
    const { data } = readPrivateFileBounded(this.filePath, {
      maxBytes: MAX_INTEGRATION_RECORD_BYTES,
      minBytes: 2,
      platform: this.platform,
      fileSystem: this.fileSystem,
    });
    try {
      return {
        data,
        document: validateIntegrationRecordDocument(JSON.parse(data.toString('utf8'))),
      };
    } catch (error) {
      data.fill(0);
      throw new Error('integration records are invalid', { cause: error });
    }
  }
}

module.exports = {
  IntegrationRecordStore,
  MAX_INTEGRATION_RECORD_BYTES,
  integrationRecordReceipt: receipt,
  sameIntegrationRecordReceipt: sameReceipt,
};
