'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  certificateFingerprint,
  loadCertificateTrust,
  normalizeCertificateOrigin,
  saveCertificateTrust,
} = require('../lib/campus-certificate-trust');

const CERTIFICATE_PEM = [
  '-----BEGIN CERTIFICATE-----',
  Buffer.from('fixture-certificate-der').toString('base64'),
  '-----END CERTIFICATE-----',
].join('\n');

test('certificate trust is limited to one exact HTTPS origin', () => {
  assert.equal(
    normalizeCertificateOrigin('https://103.189.154.10:4433/login'),
    'https://103.189.154.10:4433',
  );
  assert.throws(() => normalizeCertificateOrigin('http://103.189.154.10:4433'), /HTTPS/);
  assert.throws(() => normalizeCertificateOrigin('https://u:p@example.edu'), /HTTPS/);
});

test('certificate pins persist only a DER SHA-256 fingerprint in an owner-only file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-cert-pins-'));
  const filePath = path.join(directory, 'campus-certificate-trust.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const fingerprint = certificateFingerprint(CERTIFICATE_PEM);
  assert.equal(
    fingerprint,
    crypto.createHash('sha256').update('fixture-certificate-der').digest('hex'),
  );

  const saved = saveCertificateTrust(filePath, [{
    origin: 'https://103.189.154.10:4433/path',
    fingerprint,
    certificate: CERTIFICATE_PEM,
  }]);
  assert.deepEqual(saved, [{
    origin: 'https://103.189.154.10:4433',
    fingerprint,
  }]);
  assert.deepEqual(loadCertificateTrust(filePath), saved);
  assert.equal((fs.statSync(filePath).mode & 0o777), 0o600);
  const disk = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(disk, /BEGIN CERTIFICATE|fixture-certificate-der/);
});
