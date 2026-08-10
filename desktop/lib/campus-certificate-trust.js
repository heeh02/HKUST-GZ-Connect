'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ensureOwnerOnly, readPrivateFileBounded } = require('./private-file');

const LEGACY_TRUST_VERSION = 1;
const TRUST_VERSION = 2;
const BACKUP_SUFFIX = '.bak';
const MAX_CERTIFICATE_PINS = 32;
const MAX_PIN_CANDIDATES = MAX_CERTIFICATE_PINS * 4;
const MAX_TRUST_DOCUMENT_BYTES = 64 * 1024;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
let temporarySequence = 0;

function normalizeCertificateOrigin(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('certificate trust requires an HTTPS origin');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username ||
      parsed.password || parsed.origin === 'null') {
    throw new Error('certificate trust requires an HTTPS origin');
  }
  return parsed.origin;
}

function normalizeFingerprint(value) {
  const fingerprint = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('invalid certificate fingerprint');
  return fingerprint;
}

function certificateFingerprint(certificatePem) {
  const match = String(certificatePem || '').match(
    /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/,
  );
  if (!match) throw new Error('certificate data is unavailable');
  const encoded = match[1].replace(/\s+/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('certificate data is invalid');
  }
  const der = Buffer.from(encoded, 'base64');
  if (!der.length || der.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new Error('certificate data is invalid');
  }
  return crypto.createHash('sha256').update(der).digest('hex');
}

function safeUpdatedAt(value, now, fallback) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 &&
      value <= now + MAX_FUTURE_SKEW_MS) return value;
  return fallback;
}

function normalizeCertificatePins(input, {
  now = Date.now(),
  fallbackUpdatedAt = now,
} = {}) {
  const safeNow = Number.isSafeInteger(now) && now >= 0 ? now : Date.now();
  const safeFallback = safeUpdatedAt(fallbackUpdatedAt, safeNow, safeNow);
  const normalized = [];
  const indexByIdentity = new Map();
  const candidates = Array.isArray(input) ? input.slice(0, MAX_PIN_CANDIDATES) : [];

  for (const candidate of candidates) {
    let pin;
    try {
      pin = {
        origin: normalizeCertificateOrigin(candidate?.origin),
        fingerprint: normalizeFingerprint(candidate?.fingerprint),
        updatedAt: safeUpdatedAt(candidate?.updatedAt, safeNow, safeFallback),
      };
    } catch {
      continue;
    }
    const identity = `${pin.origin}\n${pin.fingerprint}`;
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, normalized.length);
      normalized.push(pin);
    } else if (pin.updatedAt > normalized[existingIndex].updatedAt) {
      // Duplicate input never creates a second trust grant, but the newest
      // safe timestamp survives migration and repeated single-flight writes.
      normalized[existingIndex] = pin;
    }
  }
  return normalized.slice(-MAX_CERTIFICATE_PINS);
}

function corruptDocumentError(message) {
  const error = new Error(message);
  error.certificateTrustDocumentCorrupt = true;
  return error;
}

function readTrustDocument(filePath, { now = Date.now() } = {}) {
  let record;
  try {
    record = readPrivateFileBounded(filePath, {
      maxBytes: MAX_TRUST_DOCUMENT_BYTES,
    });
  } catch (error) {
    if (error.privateFileInvalid) {
      throw corruptDocumentError('invalid certificate trust document file');
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(record.data.toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw corruptDocumentError('invalid certificate trust JSON');
    throw error;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      ![LEGACY_TRUST_VERSION, TRUST_VERSION].includes(parsed.version) ||
      !Array.isArray(parsed.pins)) {
    throw corruptDocumentError('invalid certificate trust schema');
  }

  const safeNow = Number.isSafeInteger(now) && now >= 0 ? now : Date.now();
  const fileTimestamp = safeUpdatedAt(Math.floor(record.stat.mtimeMs), safeNow, safeNow);
  const documentUpdatedAt = parsed.version === LEGACY_TRUST_VERSION
    ? fileTimestamp
    : safeUpdatedAt(parsed.updatedAt, safeNow, fileTimestamp);
  return {
    version: TRUST_VERSION,
    updatedAt: documentUpdatedAt,
    pins: normalizeCertificatePins(parsed.pins, {
      now: safeNow,
      fallbackUpdatedAt: documentUpdatedAt,
    }),
  };
}

function temporaryPathFor(filePath, label = 'tmp') {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${temporarySequence++}.${label}`,
  );
}

function writePrivateDocumentAtomic(filePath, document) {
  const directory = path.dirname(filePath);
  const temporary = temporaryPathFor(filePath);
  let descriptor = null;
  let commitApplied = false;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(document), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, filePath);
    commitApplied = true;
    ensureOwnerOnly(filePath);
    fsyncDirectory(directory);
  } catch (error) {
    if (commitApplied && error && typeof error === 'object') error.commitApplied = true;
    throw error;
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function fsyncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    // Directory fsync is unavailable on some Windows filesystems. The
    // temporary file itself is always fsynced before its atomic rename.
    if (process.platform !== 'win32') throw error;
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function removeFileDurably(filePath) {
  try {
    fs.unlinkSync(filePath);
    fsyncDirectory(path.dirname(filePath));
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

function isolateCorruptCertificateTrust(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) return '';
  } catch {
    return '';
  }
  const base = `${filePath}.corrupt-${Date.now()}`;
  for (let index = 0; index < 100; index++) {
    const destination = index ? `${base}-${index}` : base;
    if (fs.existsSync(destination)) continue;
    try {
      fs.renameSync(filePath, destination);
      ensureOwnerOnly(destination);
      return destination;
    } catch {
      return '';
    }
  }
  return '';
}

function loadCertificateTrust(filePath, options = {}) {
  try {
    return readTrustDocument(filePath, options).pins;
  } catch (error) {
    if (error?.code !== 'ENOENT' && !error.certificateTrustDocumentCorrupt) {
      // A transient I/O or permission failure is not proof that the user has
      // no saved pins. Propagate it so a revoke operation cannot report
      // success while the still-authoritative primary remains unread.
      throw error;
    }
    if (error.certificateTrustDocumentCorrupt && fs.existsSync(filePath)) {
      isolateCorruptCertificateTrust(filePath);
    }
    const backupPath = `${filePath}${BACKUP_SUFFIX}`;
    // A certificate pin is an authorization grant. Restoring a historical
    // backup could resurrect a pin the user explicitly revoked, so any lost
    // or corrupt primary fails closed. Remove the recovery copy as well to
    // prevent an older app version from reviving it after a downgrade.
    removeFileDurably(backupPath);
    return [];
  }
}

function saveCertificateTrust(filePath, pins, { now = Date.now() } = {}) {
  const safeNow = Number.isSafeInteger(now) && now >= 0 ? now : Date.now();
  const normalized = normalizeCertificatePins(pins, {
    now: safeNow,
    fallbackUpdatedAt: safeNow,
  });
  const document = { version: TRUST_VERSION, updatedAt: safeNow, pins: normalized };

  const backupPath = `${filePath}${BACKUP_SUFFIX}`;
  // A stale backup is more dangerous than no backup for an authorization
  // grant. Retire it durably before the primary commit; loading never trusts
  // a backup when the primary is unavailable.
  if (!removeFileDurably(backupPath)) throw new Error('could not retire stale certificate backup');
  writePrivateDocumentAtomic(filePath, document);
  // Keep only a same-state copy for diagnostics/downgrade compatibility. It
  // is deliberately never a trust recovery source.
  try { writePrivateDocumentAtomic(backupPath, document); } catch {}
  return normalized;
}

function deleteCertificatePin(filePath, identity, options = {}) {
  const origin = normalizeCertificateOrigin(identity?.origin);
  const fingerprint = normalizeFingerprint(identity?.fingerprint);
  const current = loadCertificateTrust(filePath, options);
  const next = current.filter((pin) => !(
    pin.origin === origin && pin.fingerprint === fingerprint
  ));
  if (next.length === current.length) return current;
  return saveCertificateTrust(filePath, next, options);
}

class CampusCertificateTrustStore {
  constructor({ filePath, now = () => Date.now() } = {}) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new TypeError('certificate trust file path must be absolute');
    }
    if (typeof now !== 'function') throw new TypeError('certificate trust clock must be a function');
    this.filePath = filePath;
    this.now = now;
  }

  list() {
    return loadCertificateTrust(this.filePath, { now: this.now() });
  }

  isTrusted(origin, fingerprint) {
    let normalizedOrigin;
    let normalizedFingerprint;
    try {
      normalizedOrigin = normalizeCertificateOrigin(origin);
      normalizedFingerprint = normalizeFingerprint(fingerprint);
    } catch {
      return false;
    }
    return this.list().some((pin) => (
      pin.origin === normalizedOrigin && pin.fingerprint === normalizedFingerprint
    ));
  }

  trust(origin, fingerprint) {
    const normalizedOrigin = normalizeCertificateOrigin(origin);
    const normalizedFingerprint = normalizeFingerprint(fingerprint);
    const now = this.now();
    // A newly approved certificate replaces older fingerprints for the same
    // exact origin. Keeping stale fingerprints would silently widen trust.
    const current = this.list().filter((pin) => pin.origin !== normalizedOrigin);
    return saveCertificateTrust(this.filePath, [
      ...current.slice(-(MAX_CERTIFICATE_PINS - 1)),
      { origin: normalizedOrigin, fingerprint: normalizedFingerprint, updatedAt: now },
    ], { now });
  }

  delete(identity) {
    return deleteCertificatePin(this.filePath, identity, { now: this.now() });
  }
}

module.exports = {
  BACKUP_SUFFIX,
  CampusCertificateTrustStore,
  LEGACY_TRUST_VERSION,
  MAX_CERTIFICATE_PINS,
  MAX_FUTURE_SKEW_MS,
  TRUST_VERSION,
  certificateFingerprint,
  deleteCertificatePin,
  isolateCorruptCertificateTrust,
  loadCertificateTrust,
  normalizeCertificateOrigin,
  normalizeCertificatePins,
  normalizeFingerprint,
  saveCertificateTrust,
};
