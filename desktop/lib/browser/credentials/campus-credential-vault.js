'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VAULT_VERSION = 1;
const MAX_ENTRIES = 100;
const MAX_USERNAME_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 4096;
const MAX_ORIGIN_LENGTH = 2048;
const MAX_VAULT_DOCUMENT_BYTES = 1024 * 1024;
const MAX_VAULT_PLAINTEXT_BYTES = 512 * 1024;
let temporarySequence = 0;

function fsyncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
    return true;
  } catch {
    // Directory handles are not available on every Windows filesystem. The
    // encrypted vault file itself is still fsynced before its atomic rename.
    return process.platform === 'win32';
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function normalizeCredentialOrigin(value) {
  if (typeof value !== 'string' || value.length > MAX_ORIGIN_LENGTH) {
    throw new Error('invalid credential origin');
  }
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('invalid credential origin');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname ||
      parsed.username || parsed.password || parsed.origin === 'null') {
    throw new Error('credentials require an HTTPS origin');
  }
  return parsed.origin;
}

function validateCredential(username, password) {
  const user = String(username || '');
  const secret = String(password || '');
  if (!secret || user.length > MAX_USERNAME_LENGTH ||
      secret.length > MAX_PASSWORD_LENGTH) {
    throw new Error('invalid site credential');
  }
  return { username: user, password: secret };
}

class CampusCredentialVault {
  constructor({ filePath, safeStorage, platform, onDurabilityWarning }) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !safeStorage) {
      throw new TypeError('invalid campus credential vault configuration');
    }
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.platform = platform;
    this.onDurabilityWarning = typeof onDurabilityWarning === 'function'
      ? onDurabilityWarning
      : null;
    this.lastDurabilityError = null;
    this.operationChain = Promise.resolve();
  }

  async available() {
    const available = typeof this.safeStorage.isAsyncEncryptionAvailable === 'function'
      ? await this.safeStorage.isAsyncEncryptionAvailable()
      : this.safeStorage.isEncryptionAvailable();
    if (!available) return false;
    return this.platform !== 'linux' ||
      this.safeStorage.getSelectedStorageBackend() !== 'basic_text';
  }

  async encrypt(value) {
    if (!await this.available()) throw new Error('protected credential storage unavailable');
    if (typeof this.safeStorage.encryptStringAsync === 'function') {
      return this.safeStorage.encryptStringAsync(value);
    }
    return this.safeStorage.encryptString(value);
  }

  async decrypt(value) {
    if (!await this.available()) throw new Error('protected credential storage unavailable');
    if (typeof this.safeStorage.decryptStringAsync === 'function') {
      const result = await this.safeStorage.decryptStringAsync(value);
      return result.result;
    }
    return this.safeStorage.decryptString(value);
  }

  async readEntries() {
    let descriptor = null;
    let wrapperText;
    try {
      const before = fs.lstatSync(this.filePath);
      if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 ||
          before.size > MAX_VAULT_DOCUMENT_BYTES ||
          (this.platform !== 'win32' && before.nlink !== 1) ||
          (this.platform !== 'win32' && (before.mode & 0o077) !== 0)) {
        throw new Error('invalid campus credential vault file');
      }
      descriptor = fs.openSync(
        this.filePath,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
      );
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
          opened.size !== before.size || opened.size > MAX_VAULT_DOCUMENT_BYTES ||
          (this.platform !== 'win32' && opened.nlink !== 1)) {
        throw new Error('invalid campus credential vault file');
      }
      const bytes = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
        if (!count) break;
        offset += count;
      }
      if (offset !== bytes.length) throw new Error('incomplete campus credential vault read');
      wrapperText = bytes.toString('utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    } finally {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch {}
      }
    }
    const wrapper = JSON.parse(wrapperText);
    wrapperText = '';
    if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper) ||
        wrapper.version !== VAULT_VERSION || typeof wrapper.ciphertext !== 'string' ||
        !/^[A-Za-z0-9+/]*={0,2}$/u.test(wrapper.ciphertext)) {
      throw new Error('unsupported campus credential vault');
    }
    const encrypted = Buffer.from(wrapper.ciphertext, 'base64');
    if (!encrypted.length || encrypted.toString('base64') !== wrapper.ciphertext ||
        encrypted.length > MAX_VAULT_DOCUMENT_BYTES) {
      throw new Error('invalid campus credential vault ciphertext');
    }
    let plaintext = await this.decrypt(encrypted);
    if (typeof plaintext !== 'string' ||
        Buffer.byteLength(plaintext) > MAX_VAULT_PLAINTEXT_BYTES) {
      plaintext = '';
      throw new Error('invalid campus credential vault plaintext');
    }
    const payload = JSON.parse(plaintext);
    plaintext = '';
    if (!Array.isArray(payload.entries) || payload.entries.length > MAX_ENTRIES) {
      throw new Error('invalid campus credential vault');
    }
    return payload.entries.map((entry) => ({
      origin: normalizeCredentialOrigin(entry.origin),
      ...validateCredential(entry.username, entry.password),
      updatedAt: Number(entry.updatedAt) || 0,
    }));
  }

  async writeEntries(entries) {
    const ciphertext = await this.encrypt(JSON.stringify({ entries }));
    if (!Buffer.isBuffer(ciphertext) || !ciphertext.length ||
        ciphertext.length > MAX_VAULT_DOCUMENT_BYTES) {
      throw new Error('invalid encrypted campus credential payload');
    }
    const wrapper = JSON.stringify({
      version: VAULT_VERSION,
      ciphertext: ciphertext.toString('base64'),
    });
    if (Buffer.byteLength(wrapper) > MAX_VAULT_DOCUMENT_BYTES) {
      throw new Error('campus credential vault exceeds the size limit');
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.${temporarySequence++}.tmp`,
    );
    let descriptor = null;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, wrapper);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporary, this.filePath);
      if (!fsyncDirectory(path.dirname(this.filePath))) {
        // The encrypted file itself is already fsynced and atomically visible.
        // A directory-fsync failure leaves crash durability uncertain, but it
        // must not be reported as an ordinary failed save: retrying against a
        // state the user was told did not exist creates an observable/UI split.
        // Record the warning while treating the visible all-old/all-new commit
        // as authoritative; a power loss can still only reveal a complete
        // encrypted document.
        const error = new Error('could not durably commit campus credential vault');
        error.commitApplied = true;
        this.lastDurabilityError = error;
        if (this.onDurabilityWarning) {
          try { this.onDurabilityWarning(error); } catch {}
        }
        return;
      }
      this.lastDurabilityError = null;
    } finally {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch {}
      }
      try { fs.unlinkSync(temporary); } catch {}
    }
  }

  async get(rawOrigin) {
    const origin = normalizeCredentialOrigin(rawOrigin);
    const entries = await this.readEntries();
    return entries.find((entry) => entry.origin === origin) || null;
  }

  async save(rawOrigin, rawUsername, rawPassword) {
    const origin = normalizeCredentialOrigin(rawOrigin);
    const credential = validateCredential(rawUsername, rawPassword);
    return this.serialize(async () => {
      const entries = await this.readEntries();
      const withoutOrigin = entries.filter((entry) => entry.origin !== origin);
      if (withoutOrigin.length >= MAX_ENTRIES) {
        throw new Error('campus credential vault is full');
      }
      withoutOrigin.push({
        origin,
        ...credential,
        updatedAt: Date.now(),
      });
      await this.writeEntries(withoutOrigin);
    });
  }

  async remove(rawOrigin) {
    const origin = normalizeCredentialOrigin(rawOrigin);
    return this.serialize(async () => {
      const entries = await this.readEntries();
      const remaining = entries.filter((entry) => entry.origin !== origin);
      if (remaining.length === entries.length) return false;
      await this.writeEntries(remaining);
      return true;
    });
  }

  async count() {
    return (await this.readEntries()).length;
  }

  serialize(operation) {
    const next = this.operationChain.then(operation, operation);
    this.operationChain = next.catch(() => {});
    return next;
  }
}

module.exports = {
  CampusCredentialVault,
  MAX_VAULT_DOCUMENT_BYTES,
  normalizeCredentialOrigin,
  validateCredential,
};
