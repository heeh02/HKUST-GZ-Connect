'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  BACKUP_SUFFIX,
  CampusCertificateTrustStore,
  MAX_FUTURE_SKEW_MS,
  TRUST_VERSION,
  certificateFingerprint,
  deleteCertificatePin,
  loadCertificateTrust,
  normalizeCertificateOrigin,
  normalizeCertificatePins,
  saveCertificateTrust,
} = require('../../../../lib/browser/certificates/campus-certificate-trust');

const CERTIFICATE_PEM = [
  '-----BEGIN CERTIFICATE-----',
  Buffer.from('fixture-certificate-der').toString('base64'),
  '-----END CERTIFICATE-----',
].join('\n');
const FIRST_FINGERPRINT = 'a'.repeat(64);
const SECOND_FINGERPRINT = 'b'.repeat(64);

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-cert-pins-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'campus-certificate-trust.json');
}

function corruptFiles(directory, basename) {
  return fs.readdirSync(directory).filter((name) => name.startsWith(`${basename}.corrupt-`));
}

test('certificate trust is limited to one exact HTTPS origin', () => {
  assert.equal(
    normalizeCertificateOrigin('https://103.189.154.10:4433/login'),
    'https://103.189.154.10:4433',
  );
  assert.equal(normalizeCertificateOrigin('https://example.edu:443/path'), 'https://example.edu');
  assert.throws(() => normalizeCertificateOrigin('http://103.189.154.10:4433'), /HTTPS/);
  assert.throws(() => normalizeCertificateOrigin('https://u:p@example.edu'), /HTTPS/);
});

test('pin normalization deduplicates exact origin plus SHA-256 and bounds updatedAt', () => {
  const now = 1_800_000_000_000;
  const pins = normalizeCertificatePins([
    { origin: 'https://example.edu/a', fingerprint: FIRST_FINGERPRINT, updatedAt: now - 20 },
    { origin: 'https://example.edu/b', fingerprint: FIRST_FINGERPRINT, updatedAt: now - 10 },
    { origin: 'https://example.edu', fingerprint: SECOND_FINGERPRINT, updatedAt: now - 5 },
    {
      origin: 'https://future.example.edu',
      fingerprint: FIRST_FINGERPRINT,
      updatedAt: now + MAX_FUTURE_SKEW_MS + 1,
    },
  ], { now, fallbackUpdatedAt: now });

  assert.deepEqual(pins, [
    { origin: 'https://example.edu', fingerprint: FIRST_FINGERPRINT, updatedAt: now - 10 },
    { origin: 'https://example.edu', fingerprint: SECOND_FINGERPRINT, updatedAt: now - 5 },
    { origin: 'https://future.example.edu', fingerprint: FIRST_FINGERPRINT, updatedAt: now },
  ]);
});

test('certificate pins persist only versioned metadata in atomic owner-only files', (t) => {
  const filePath = fixture(t);
  const fingerprint = certificateFingerprint(CERTIFICATE_PEM);
  const now = 1_800_000_000_000;
  assert.equal(
    fingerprint,
    crypto.createHash('sha256').update('fixture-certificate-der').digest('hex'),
  );

  const saved = saveCertificateTrust(filePath, [{
    origin: 'https://103.189.154.10:4433/path',
    fingerprint,
    certificate: CERTIFICATE_PEM,
  }], { now });
  assert.deepEqual(saved, [{
    origin: 'https://103.189.154.10:4433',
    fingerprint,
    updatedAt: now,
  }]);
  assert.deepEqual(loadCertificateTrust(filePath, { now }), saved);
  if (process.platform !== 'win32') {
    assert.equal((fs.statSync(filePath).mode & 0o777), 0o600);
    assert.equal((fs.statSync(`${filePath}${BACKUP_SUFFIX}`).mode & 0o777), 0o600);
  }
  const disk = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(disk, /BEGIN CERTIFICATE|fixture-certificate-der/);
  assert.deepEqual(JSON.parse(disk), {
    version: TRUST_VERSION,
    updatedAt: now,
    pins: saved,
  });
  assert.deepEqual(
    fs.readdirSync(path.dirname(filePath)).filter((name) => name.includes('.tmp')),
    [],
  );
});

test('legacy v1 pins load with a safe stable timestamp and migrate on save', (t) => {
  const filePath = fixture(t);
  const legacyTime = 1_700_000_000_000;
  const now = legacyTime + 10_000;
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    pins: [{ origin: 'https://legacy.example.edu/path', fingerprint: FIRST_FINGERPRINT }],
  }), { mode: 0o600 });
  fs.utimesSync(filePath, new Date(legacyTime), new Date(legacyTime));

  const loaded = loadCertificateTrust(filePath, { now });
  assert.deepEqual(loaded, [{
    origin: 'https://legacy.example.edu',
    fingerprint: FIRST_FINGERPRINT,
    updatedAt: legacyTime,
  }]);
  saveCertificateTrust(filePath, loaded, { now });
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).version, TRUST_VERSION);
});

test('a corrupt primary is isolated and certificate trust fails closed', (t) => {
  const filePath = fixture(t);
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const first = [{ origin: 'https://first.example.edu', fingerprint: FIRST_FINGERPRINT }];
  const second = [{ origin: 'https://second.example.edu', fingerprint: SECOND_FINGERPRINT }];
  saveCertificateTrust(filePath, first, { now: 1_800_000_000_000 });
  saveCertificateTrust(filePath, second, { now: 1_800_000_010_000 });
  fs.writeFileSync(filePath, '{broken', { mode: 0o600 });

  const restored = loadCertificateTrust(filePath, { now: 1_800_000_020_000 });
  assert.deepEqual(restored, []);
  assert.equal(corruptFiles(directory, basename).length, 1);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.existsSync(`${filePath}${BACKUP_SUFFIX}`), false);
});

test('a missing primary never restores certificate authorization from backup', (t) => {
  const filePath = fixture(t);
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const expected = saveCertificateTrust(filePath, [{
    origin: 'https://backup.example.edu',
    fingerprint: FIRST_FINGERPRINT,
  }], { now: 1_800_000_000_000 });
  fs.unlinkSync(filePath);

  assert.ok(expected.length > 0);
  assert.deepEqual(loadCertificateTrust(filePath, { now: 1_800_000_010_000 }), []);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.existsSync(`${filePath}${BACKUP_SUFFIX}`), false);
  assert.deepEqual(corruptFiles(directory, basename), []);
});

test('a corrupt primary is isolated and every backup grant is discarded', (t) => {
  const filePath = fixture(t);
  const directory = path.dirname(filePath);
  fs.writeFileSync(filePath, 'bad-primary', { mode: 0o600 });
  fs.writeFileSync(`${filePath}${BACKUP_SUFFIX}`, 'bad-backup', { mode: 0o600 });

  assert.deepEqual(loadCertificateTrust(filePath), []);
  const names = fs.readdirSync(directory);
  assert.equal(names.some((name) => name.startsWith(`${path.basename(filePath)}.corrupt-`)), true);
  assert.equal(fs.existsSync(`${filePath}${BACKUP_SUFFIX}`), false);
});

test('atomic replacement failure leaves the prior trust document intact', (t) => {
  const filePath = fixture(t);
  const expected = saveCertificateTrust(filePath, [{
    origin: 'https://stable.example.edu',
    fingerprint: FIRST_FINGERPRINT,
  }], { now: 1_800_000_000_000 });
  const originalRename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (destination === filePath) throw new Error('simulated atomic commit failure');
    return originalRename(source, destination);
  };
  try {
    assert.throws(() => saveCertificateTrust(filePath, [{
      origin: 'https://new.example.edu',
      fingerprint: SECOND_FINGERPRINT,
    }], { now: 1_800_000_010_000 }), /atomic commit failure/);
  } finally {
    fs.renameSync = originalRename;
  }

  assert.deepEqual(loadCertificateTrust(filePath, { now: 1_800_000_020_000 }), expected);
  assert.deepEqual(
    fs.readdirSync(path.dirname(filePath)).filter((name) => name.endsWith('.tmp')),
    [],
  );
});

test('deleting one exact pin leaves other fingerprints and origins untouched', (t) => {
  const filePath = fixture(t);
  saveCertificateTrust(filePath, [
    { origin: 'https://same.example.edu', fingerprint: FIRST_FINGERPRINT },
    { origin: 'https://same.example.edu', fingerprint: SECOND_FINGERPRINT },
    { origin: 'https://other.example.edu', fingerprint: FIRST_FINGERPRINT },
  ], { now: 1_800_000_000_000 });

  const remaining = deleteCertificatePin(filePath, {
    origin: 'https://same.example.edu/path',
    fingerprint: FIRST_FINGERPRINT,
  }, { now: 1_800_000_010_000 });
  assert.deepEqual(remaining.map(({ origin, fingerprint }) => ({ origin, fingerprint })), [
    { origin: 'https://same.example.edu', fingerprint: SECOND_FINGERPRINT },
    { origin: 'https://other.example.edu', fingerprint: FIRST_FINGERPRINT },
  ]);
  assert.throws(() => deleteCertificatePin(filePath, {
    origin: 'http://same.example.edu',
    fingerprint: FIRST_FINGERPRINT,
  }), /HTTPS/);
});

test('a revoked certificate cannot be resurrected after primary corruption', (t) => {
  const filePath = fixture(t);
  saveCertificateTrust(filePath, [{
    origin: 'https://revoked.example.edu',
    fingerprint: FIRST_FINGERPRINT,
  }], { now: 1_800_000_000_000 });
  deleteCertificatePin(filePath, {
    origin: 'https://revoked.example.edu',
    fingerprint: FIRST_FINGERPRINT,
  }, { now: 1_800_000_010_000 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${filePath}${BACKUP_SUFFIX}`, 'utf8')).pins, []);

  fs.writeFileSync(filePath, '{broken', { mode: 0o600 });
  assert.deepEqual(loadCertificateTrust(filePath, { now: 1_800_000_020_000 }), []);
});

test('a transient trust-file read failure cannot masquerade as a successful revoke', (t) => {
  const filePath = fixture(t);
  saveCertificateTrust(filePath, [{
    origin: 'https://still-trusted.example.edu',
    fingerprint: FIRST_FINGERPRINT,
  }], { now: 1_800_000_000_000 });
  const originalOpen = fs.openSync;
  fs.openSync = (candidate, ...args) => {
    if (candidate === filePath) {
      const error = new Error('simulated transient I/O error');
      error.code = 'EIO';
      throw error;
    }
    return originalOpen(candidate, ...args);
  };
  try {
    assert.throws(() => deleteCertificatePin(filePath, {
      origin: 'https://still-trusted.example.edu',
      fingerprint: FIRST_FINGERPRINT,
    }, { now: 1_800_000_010_000 }), /transient I\/O/);
  } finally {
    fs.openSync = originalOpen;
  }
  assert.equal(loadCertificateTrust(filePath, { now: 1_800_000_020_000 }).length, 1);
});

test('certificate authorization never follows a symlink or a broad-permission file', (t) => {
  const filePath = fixture(t);
  const target = `${filePath}.target`;
  fs.writeFileSync(target, JSON.stringify({
    version: TRUST_VERSION,
    updatedAt: 1_800_000_000_000,
    pins: [{
      origin: 'https://unsafe.example.edu',
      fingerprint: FIRST_FINGERPRINT,
      updatedAt: 1_800_000_000_000,
    }],
  }), { mode: 0o600 });
  fs.symlinkSync(target, filePath);
  assert.deepEqual(loadCertificateTrust(filePath, { now: 1_800_000_010_000 }), []);
  assert.equal(fs.existsSync(target), true);

  if (process.platform !== 'win32') {
    fs.writeFileSync(filePath, fs.readFileSync(target), { mode: 0o644 });
    fs.chmodSync(filePath, 0o644);
    assert.deepEqual(loadCertificateTrust(filePath, { now: 1_800_000_010_000 }), []);
  }
});

test('store interface matches browser single-flight and replaces stale origin fingerprints', (t) => {
  const filePath = fixture(t);
  let now = 1_800_000_000_000;
  const store = new CampusCertificateTrustStore({ filePath, now: () => now });

  // CampusBrowser awaits trust() and calls isTrusted() synchronously. The
  // store intentionally supports exactly that interface.
  store.trust('https://portal.example.edu/login', FIRST_FINGERPRINT);
  assert.equal(store.isTrusted('https://portal.example.edu/path', FIRST_FINGERPRINT), true);
  assert.equal(store.isTrusted('https://portal.example.edu.evil.test', FIRST_FINGERPRINT), false);
  now += 1000;
  store.trust('https://portal.example.edu/again', SECOND_FINGERPRINT);
  assert.equal(store.isTrusted('https://portal.example.edu', FIRST_FINGERPRINT), false);
  assert.equal(store.isTrusted('https://portal.example.edu', SECOND_FINGERPRINT), true);
  assert.deepEqual(store.list(), [{
    origin: 'https://portal.example.edu',
    fingerprint: SECOND_FINGERPRINT,
    updatedAt: now,
  }]);
  store.delete({ origin: 'https://portal.example.edu', fingerprint: SECOND_FINGERPRINT });
  assert.deepEqual(store.list(), []);
});
