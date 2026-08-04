'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ensureOwnerOnly } = require('./private-file');

const TRUST_VERSION = 1;
const MAX_CERTIFICATE_PINS = 32;

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

function normalizeCertificatePins(input) {
  const seenOrigins = new Set();
  return (Array.isArray(input) ? input : [])
    .map((candidate) => {
      try {
        return {
          origin: normalizeCertificateOrigin(candidate?.origin),
          fingerprint: normalizeFingerprint(candidate?.fingerprint),
        };
      } catch {
        return null;
      }
    })
    .filter((candidate) => {
      if (!candidate || seenOrigins.has(candidate.origin)) return false;
      seenOrigins.add(candidate.origin);
      return true;
    })
    .slice(0, MAX_CERTIFICATE_PINS);
}

function loadCertificateTrust(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed?.version !== TRUST_VERSION) return [];
    return normalizeCertificatePins(parsed.pins);
  } catch {
    return [];
  }
}

function saveCertificateTrust(filePath, pins) {
  const normalized = normalizeCertificatePins(pins);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify({ version: TRUST_VERSION, pins: normalized }), { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  ensureOwnerOnly(filePath);
  return normalized;
}

module.exports = {
  MAX_CERTIFICATE_PINS,
  TRUST_VERSION,
  certificateFingerprint,
  loadCertificateTrust,
  normalizeCertificateOrigin,
  normalizeCertificatePins,
  saveCertificateTrust,
};
