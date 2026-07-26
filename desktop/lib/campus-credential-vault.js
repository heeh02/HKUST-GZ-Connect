'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VAULT_VERSION = 1;
const MAX_ENTRIES = 100;
const MAX_USERNAME_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 4096;

function normalizeCredentialOrigin(value) {
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
  constructor({ filePath, safeStorage, platform }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.platform = platform;
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
    if (!fs.existsSync(this.filePath)) return [];
    const wrapper = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (wrapper.version !== VAULT_VERSION || typeof wrapper.ciphertext !== 'string') {
      throw new Error('unsupported campus credential vault');
    }
    const plaintext = await this.decrypt(Buffer.from(wrapper.ciphertext, 'base64'));
    const payload = JSON.parse(plaintext);
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
    const wrapper = JSON.stringify({
      version: VAULT_VERSION,
      ciphertext: ciphertext.toString('base64'),
    });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, wrapper, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
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
  normalizeCredentialOrigin,
  validateCredential,
};
